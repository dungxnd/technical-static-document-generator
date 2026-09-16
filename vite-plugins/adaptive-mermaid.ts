/**
 * Build-time pruning for Mermaid.
 *
 * Mermaid chooses a renderer from a runtime string, so every diagram loader it
 * registers stays reachable and every one is emitted. `vite-plugin-singlefile`
 * inlines dynamic imports into the single artifact, which turns that laziness
 * into shipped bytes: ~4.9 MB of diagram implementations and layout engines for
 * diagrams a document never draws.
 *
 * A document set is static, so the diagrams it can ask for are knowable now.
 * This plugin reads the content, keeps the implementation modules those diagrams
 * need, and replaces every other diagram, layout engine and conditional
 * dependency with a stub.
 *
 * Detection is strict on purpose. If a diagram's type cannot be proven from the
 * source, nothing is pruned at all: a larger bundle is a far better failure than
 * a diagram that silently stops rendering.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const VIRTUAL_PREFIX = '\0adaptive-mermaid:';

/**
 * Keyword opening a diagram source → Mermaid's internal type id. Ids are
 * validated against the installed Mermaid before use, so a rename upstream
 * surfaces as a build error naming the type rather than a missing diagram.
 * Order matters: `railroad-abnf` has to be tested before `railroad`.
 */
const TYPE_KEYWORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:graph|flowchart)\b/i, 'flowchart-v2'],
  [/^sequenceDiagram\b/i, 'sequence'],
  [/^classDiagram/i, 'classDiagram'],
  [/^stateDiagram/i, 'stateDiagram'],
  [/^erDiagram/i, 'er'],
  [/^gantt\b/i, 'gantt'],
  [/^pie\b/i, 'pie'],
  [/^journey\b/i, 'journey'],
  [/^gitGraph/i, 'gitGraph'],
  [/^mindmap\b/i, 'mindmap'],
  [/^timeline\b/i, 'timeline'],
  [/^quadrantChart\b/i, 'quadrantChart'],
  [/^requirementDiagram\b/i, 'requirement'],
  [/^sankey-beta\b/i, 'sankey'],
  [/^xychart-beta\b/i, 'xychart'],
  [/^block-beta\b/i, 'block'],
  [/^packet-beta\b/i, 'packet'],
  [/^radar-beta\b/i, 'radar'],
  [/^treemap-beta\b/i, 'treemap'],
  [/^treeView-beta\b/i, 'treeView'],
  [/^architecture-beta\b/i, 'architecture'],
  [/^kanban\b/i, 'kanban'],
  [/^venn-beta\b/i, 'venn'],
  [/^wardley-beta\b/i, 'wardley'],
  [/^cynefin-beta\b/i, 'cynefin'],
  [/^ishikawa\b/i, 'ishikawa'],
  [/^usecase\b/i, 'usecase'],
  [/^eventmodeling\b/i, 'eventmodeling'],
  [/^swimlane\b/i, 'swimlane'],
  [/^agentflow\b/i, 'agentflow'],
  [/^C4\w*/i, 'c4'],
  [/^info\b/i, 'info'],
  [/^railroad-abnf\b/i, 'railroadAbnf'],
  [/^railroad-ebnf\b/i, 'railroadEbnf'],
  [/^railroad-peg\b/i, 'railroadPeg'],
  [/^railroad\b/i, 'railroad'],
];

/**
 * Layout engines Mermaid loads on demand by name. `dagre` draws every flowchart
 * whose source does not ask for something else, so it is never pruned.
 */
const LAYOUT_PREFIXES: Readonly<Record<string, string>> = {
  dagre: 'dagre-',
  swimlane: 'swimlanes-',
  'cose-bilkent': 'cose-bilkent-',
  elk: 'elk-',
};

const ALWAYS_KEPT_LAYOUT = 'dagre';

/**
 * Mermaid 12 lays these out with ELK and falls back to Dagre only when it is
 * absent, so for them ELK is part of the default rendering rather than an
 * opt-in — pruning it would change how a diagram draws.
 */
const ELK_DEFAULT_TYPES = new Set([
  'flowchart-v2',
  'stateDiagram',
  'classDiagram',
  'er',
  'requirement',
  'usecase',
  'agentflow',
]);

/** Mindmaps are the one diagram type that defaults to cose-bilkent instead. */
const COSE_DEFAULT_TYPES = new Set(['mindmap']);

/** Reached from inside a diagram renderer for `$$…$$` labels, never at import. */
const MATH_DEPENDENCY = 'katex';

const DIAGRAM_STUB = [
  'export const diagram = {',
  '  db: { clear() {} },',
  '  parser: {',
  '    parse() {',
  '      throw new Error(',
  '        "This diagram type was pruned at build time because no document used it. " +',
  '          "Add the diagram to src/content and rebuild.",',
  '      );',
  '    },',
  '  },',
  '  renderer: { draw() {} },',
  '  styles: {},',
  '  init: () => null,',
  '  getConfig: () => ({}),',
  '};',
].join('\n');

const MATH_STUB = [
  'const unavailable = () => {',
  '  throw new Error(',
  '    "katex was pruned at build time because no diagram used $$…$$ labels.",',
  '  );',
  '};',
  'export default { renderToString: unavailable, render: unavailable };',
].join('\n');

interface MermaidInternals {
  /** Mermaid type id → implementation module file name. */
  diagrams: Map<string, string>;
  /** `layout:` name → layout module file name. */
  layouts: Map<string, string>;
}

/* ── Mermaid internals ────────────────────────────────────────────────── */

/**
 * Reads Mermaid's own registration table rather than hardcoding file names.
 * Core declares each diagram as `var id<n> = "<type>"` followed by a loader that
 * dynamically imports its module, in the same order, so the two lists pair up.
 */
function readMermaidInternals(): MermaidInternals | null {
  let coreFile: string;
  try {
    coreFile = createRequire(import.meta.url).resolve('mermaid/dist/mermaid.core.mjs');
  } catch {
    return null;
  }

  const source = fs.readFileSync(coreFile, 'utf8');
  const ids = [...source.matchAll(/var id\w* = "([^"]+)";/g)].map((match) => match[1]);
  const modules = [...source.matchAll(/await import\("\.\/chunks\/mermaid\.core\/([^"]+)"\)/g)].map(
    (match) => match[1],
  );
  if (ids.length === 0 || ids.length !== modules.length) return null;

  const chunksDir = path.join(path.dirname(coreFile), 'chunks', 'mermaid.core');
  if (!fs.existsSync(chunksDir)) return null;
  const present = new Set(fs.readdirSync(chunksDir));

  const diagrams = new Map<string, string>();
  ids.forEach((id, index) => {
    const file = modules[index];
    if (present.has(file)) diagrams.set(id, file);
  });

  const layouts = new Map<string, string>();
  for (const [name, prefix] of Object.entries(LAYOUT_PREFIXES)) {
    const file = [...present].find((entry) => entry.startsWith(prefix) && entry.endsWith('.mjs'));
    if (file) layouts.set(name, file);
  }

  return { diagrams, layouts };
}

/* ── content scan ─────────────────────────────────────────────────────── */

interface DiagramUsage {
  file: string;
  type: string;
  source: string;
}

interface ContentScan {
  usages: DiagramUsage[];
  /** `layout:` names any diagram asks for. */
  layouts: Set<string>;
  /** Whether any diagram carries `$$…$$` labels. */
  math: boolean;
  /** Usages that could not be proven, each with the reason. */
  problems: string[];
}

/** Reads the balanced `{…}` expression starting at `open`. */
function readBraced(source: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;

  for (let index = open; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '`' || char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }

  return null;
}

/**
 * Reads the string or template literal at `start`. A template literal holding an
 * interpolation is refused: its value is not knowable at build time.
 */
function readLiteral(source: string, start: number): string | null {
  const quote = source[start];
  if (quote !== '`' && quote !== '"' && quote !== "'") return null;

  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      value += source[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (char === quote) return value;
    if (quote === '`' && char === '$' && source[index + 1] === '{') return null;
    value += char;
  }

  return null;
}

/** Resolves a `code={…}` expression to its literal value. */
function resolveCode(source: string, expression: string): string | null {
  const trimmed = expression.trim();

  if (trimmed.startsWith('`') || trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return readLiteral(trimmed, 0);
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(trimmed)) return null;

  const declaration = new RegExp(`(?:^|[;{\\s])const\\s+${trimmed}\\s*=\\s*`, 'm').exec(source);
  if (!declaration) return null;

  return readLiteral(source, declaration.index + declaration[0].length);
}

/** The type id declared by a diagram source, from its first meaningful line. */
function diagramType(source: string): string | null {
  const opening = source
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('%%'));
  if (!opening) return null;

  const keyword = TYPE_KEYWORDS.find(([pattern]) => pattern.test(opening));
  return keyword ? keyword[1] : null;
}

function contentFiles(dir: string): string[] {
  return walk(dir, /\.(?:svx|md)$/i);
}

/** Local names a document binds `MermaidDiagram` to, so aliases are not missed. */
function componentNames(source: string): string[] {
  const names = ['MermaidDiagram'];
  for (const match of source.matchAll(
    /import\s+(\w+)\s+from\s+['"][^'"]*MermaidDiagram\.svelte['"]/g,
  )) {
    names.push(match[1]);
  }
  return names;
}

function scanContent(contentDir: string, root: string): ContentScan {
  const scan: ContentScan = { usages: [], layouts: new Set(), math: false, problems: [] };

  for (const file of contentFiles(contentDir)) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file).replace(/\\/g, '/');
    const tags = new RegExp(`<(${componentNames(source).join('|')})\\b([\\s\\S]*?)\\/?>`, 'g');

    for (const tag of source.matchAll(tags)) {
      const attributes = tag[2];
      const prop = /code\s*=\s*\{/g.exec(attributes);

      if (!prop) {
        scan.problems.push(`${relative}: <${tag[1]}> has no code={…} prop`);
        continue;
      }

      const expression = readBraced(attributes, prop.index + prop[0].length - 1);
      const diagram = expression === null ? null : resolveCode(source, expression);

      if (diagram === null) {
        scan.problems.push(
          `${relative}: the code={…} of <${tag[1]}> is not a literal this build can read. ` +
            'Assign the diagram to a `const` holding a template literal so its type is provable.',
        );
        continue;
      }

      const type = diagramType(diagram);
      if (type === null) {
        const opening = diagram.split('\n').find((line) => line.trim() !== '') ?? '';
        scan.problems.push(
          `${relative}: unrecognised diagram type "${opening.trim().slice(0, 40)}". ` +
            'Add it to TYPE_KEYWORDS in vite-plugins/adaptive-mermaid.ts.',
        );
        continue;
      }

      if (/\$\$/.test(diagram)) scan.math = true;
      for (const layout of diagram.matchAll(/^\s*layout\s*:\s*['"]?([\w-]+)/gim)) {
        scan.layouts.add(layout[1]);
      }

      scan.usages.push({ file: relative, type, source: diagram });
    }
  }

  return scan;
}

/** Every file under `dir` whose name matches `pattern`, walked recursively. */
function walk(dir: string, pattern: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

/**
 * Layout names the app pins through `mermaid.initialize`. A pinned default is
 * what makes an engine genuinely unnecessary — without one, the diagram falls
 * back to whatever Mermaid itself would have chosen.
 */
function pinnedLayouts(srcDir: string): Set<string> {
  const pinned = new Set<string>();

  for (const file of walk(srcDir, /\.(?:svelte|ts|js)$/i)) {
    const source = fs.readFileSync(file, 'utf8');
    const call = /mermaid\.initialize\s*\(/.exec(source);
    if (!call) continue;

    const open = source.indexOf('{', call.index + call[0].length);
    const options = open === -1 ? null : readBraced(source, open);
    if (options === null) continue;

    for (const match of options.matchAll(/\blayout\s*:\s*['"]([\w-]+)['"]/g)) pinned.add(match[1]);
  }

  return pinned;
}

/**
 * Documents outside the scanned directory can hold diagrams this plugin cannot
 * see, which would leave their renderer pruned. Worth a warning, never a failure.
 */
function importsOutsideContent(root: string, contentDir: string, srcDir: string): string[] {
  const content = path.resolve(contentDir);

  return walk(srcDir, /\.(?:svelte|svx|md|ts|js)$/i)
    .filter((file) => !file.startsWith(content))
    .filter((file) => /MermaidDiagram\.svelte/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).replace(/\\/g, '/'));
}

/* ── plugin ───────────────────────────────────────────────────────────── */

export interface AdaptiveMermaidOptions {
  /** Directory scanned for `<MermaidDiagram>` usages, relative to the project root. */
  contentDir?: string;
}

export function adaptiveMermaid(options: AdaptiveMermaidOptions = {}): Plugin {
  const { contentDir = 'src/content' } = options;

  let root = process.cwd();
  let isBuild = true;
  let internals: MermaidInternals | null = null;
  /** Stubbed module file names and package specifiers → the source served for them. */
  const stubs = new Map<string, string>();

  return {
    name: 'adaptive-mermaid',

    // Ahead of Vite's resolver so the dynamic imports Mermaid issues from inside
    // node_modules are intercepted before they are turned into absolute paths.
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
      isBuild = config.command === 'build';
      internals = readMermaidInternals();

      if (!internals) {
        config.logger.warn(
          '[adaptive-mermaid] Mermaid internals could not be read; every diagram type will ship.',
        );
      }
    },

    resolveId(id) {
      const file = id.replace(/\\/g, '/').split('/').pop() ?? '';
      if (stubs.has(file)) return VIRTUAL_PREFIX + file;
      if (stubs.has(id)) return VIRTUAL_PREFIX + file;
      return null;
    },

    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;
      const key = id.slice(VIRTUAL_PREFIX.length);
      return stubs.get(key) ?? null;
    },

    buildStart() {
      const mermaid = internals;
      if (!mermaid) return;

      const scan = scanContent(path.resolve(root, contentDir), root);

      // Anything unprovable means the reachable set is unknown, so nothing is
      // pruned and the artifact keeps every diagram.
      if (scan.problems.length > 0) {
        const message =
          `[adaptive-mermaid] could not prove which diagrams this content uses, so no pruning ` +
          `was applied:\n${scan.problems.map((problem) => `  - ${problem}`).join('\n')}`;
        if (isBuild) {
          this.error(message);
        } else {
          this.warn(message);
        }
        return;
      }

      const unknown = [...new Set(scan.usages.map((usage) => usage.type))].filter(
        (type) => !mermaid.diagrams.has(type),
      );
      if (unknown.length > 0) {
        const names = [...mermaid.diagrams.keys()].sort().join(', ');
        const message = `[adaptive-mermaid] the installed Mermaid has no diagram type ${unknown.join(', ')}. Known types: ${names}.`;
        if (isBuild) {
          this.error(message);
        } else {
          this.warn(message);
        }
        return;
      }

      const forContent = importsOutsideContent(
        root,
        path.resolve(root, contentDir),
        path.resolve(root, 'src'),
      );
      if (forContent.length > 0) {
        this.warn(
          `[adaptive-mermaid] ${forContent.join(', ')} import MermaidDiagram outside ${contentDir}, ` +
            'so any diagram authored there is invisible to this scan.',
        );
      }

      const keptTypes = new Set(scan.usages.map((usage) => usage.type));
      const implementations = [...new Set(mermaid.diagrams.values())];
      const keptModules = new Set(
        [...keptTypes].map((type) => mermaid.diagrams.get(type)).filter((file) => file !== undefined),
      );

      const prunedDiagrams = implementations.filter((file) => !keptModules.has(file));

      // Anything the app or a diagram asks for by name is kept. When nothing is
      // named, Mermaid's own default for the surviving diagram types decides —
      // pruning an engine a diagram would have used changes how it draws.
      const declared = new Set([...scan.layouts, ...pinnedLayouts(path.resolve(root, 'src'))]);
      const defaultsTo = (types: Set<string>) => [...keptTypes].some((type) => types.has(type));
      const keepsLayout = (name: string): boolean => {
        if (name === ALWAYS_KEPT_LAYOUT) return true;
        if (declared.has(name)) return true;
        if (declared.size > 0) return false;
        if (name === 'elk') return defaultsTo(ELK_DEFAULT_TYPES);
        if (name === 'cose-bilkent') return defaultsTo(COSE_DEFAULT_TYPES);
        return false;
      };

      const prunedLayouts = [...mermaid.layouts.entries()]
        .filter(([name]) => !keepsLayout(name))
        .map(([, file]) => file);

      stubs.clear();
      for (const file of [...prunedDiagrams, ...prunedLayouts]) stubs.set(file, DIAGRAM_STUB);
      if (!scan.math) stubs.set(MATH_DEPENDENCY, MATH_STUB);

      const types = [...keptTypes].sort().join(', ') || 'none';
      this.info(
        `[adaptive-mermaid] ${scan.usages.length} diagram(s) in ${contentDir}: ${types}\n` +
          `[adaptive-mermaid] kept ${implementations.length - prunedDiagrams.length}/${implementations.length} diagram implementations, ` +
          `pruned ${prunedLayouts.length} unused layout engine(s)${scan.math ? ', kept katex for $$…$$ labels' : ', pruned katex'}`,
      );
    },
  };
}
