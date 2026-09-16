import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { uniqueSlug } from '../src/lib/slugify.ts';

const VIRTUAL_ID = 'virtual:docs-index';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

const CONTENT_EXTENSION = /\.(?:svx|svelte\.md|md)$/i;
/** `01-architecture.svx` → `architecture`, matching sidebar.ts doc ids. */
const ORDER_PREFIX = /^\d+[-_]/;

export interface DocsHeading {
  id: string;
  text: string;
  level: number;
  /** Plain text between this heading and the next — gives results a snippet. */
  body: string;
}

export interface DocsRecord {
  docId: string;
  file: string;
  title: string;
  headings: DocsHeading[];
  text: string;
}

export interface DocsIndexOptions {
  /** Directory scanned for documents. Relative to the project root. */
  contentDir?: string;
  /** Path to the sidebar config, read as text to validate doc ids. */
  sidebarFile?: string;
  /** Emit a warning when a content file has no sidebar entry. */
  warnOnOrphans?: boolean;
}

/* ── extraction ───────────────────────────────────────────────────────── */

function stripScriptBlocks(source: string): string {
  return source.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
}

/** Collapse everything that renders as plain text back to plain text. */
function stripInlineMarkdown(input: string): string {
  return input
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '');
}

function stripMarkdownLine(input: string): string {
  return stripInlineMarkdown(
    input
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/^\s{0,3}[-*+]\s+/, '')
      .replace(/^\s{0,3}\d+[.)]\s+/, '')
      .replace(/\|/g, ' '),
  ).trim();
}

function extractDocument(source: string, docId: string): Omit<DocsRecord, 'file'> {
  // Component tags first — they can span lines and carry expressions.
  const withoutComponents = stripScriptBlocks(source)
    .replace(/<\/?[A-Za-z][^>]*>/gs, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const headings: DocsHeading[] = [];
  const sectionBodies: string[][] = [];
  const seen = new Set<string>();
  const textParts: string[] = [];
  let title = '';
  let inFence = false;
  let openSection: string[] | null = null;

  const collapse = (parts: string[]) => parts.join(' ').replace(/\s+/g, ' ').trim();

  for (const rawLine of withoutComponents.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }

    // Fenced code stays searchable: identifiers are exactly what people look for.
    if (inFence) {
      textParts.push(line);
      openSection?.push(line);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const text = stripInlineMarkdown(heading[2]).trim();
      if (!text) continue;

      const level = heading[1].length;
      headings.push({ id: uniqueSlug(text, seen), text, level, body: '' });
      openSection = [];
      sectionBodies.push(openSection);

      if (level === 1 && !title) title = text;
      textParts.push(text);
      continue;
    }

    const prose = stripMarkdownLine(line);
    textParts.push(prose);
    openSection?.push(prose);
  }

  headings.forEach((entry, index) => {
    entry.body = collapse(sectionBodies[index] ?? []).slice(0, 400);
  });

  return {
    docId,
    title: title || docId,
    headings,
    text: collapse(textParts),
  };
}

/* ── plugin ───────────────────────────────────────────────────────────── */

export function docsIndex(options: DocsIndexOptions = {}): Plugin {
  const {
    contentDir = 'src/content',
    sidebarFile = 'src/config/sidebar.ts',
    warnOnOrphans = true,
  } = options;

  let root = process.cwd();
  let contentRoot = path.resolve(root, contentDir);
  let watched: string[] = [];

  function listContentFiles(): string[] {
    if (!fs.existsSync(contentRoot)) return [];
    return fs
      .readdirSync(contentRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && CONTENT_EXTENSION.test(entry.name))
      .map((entry) => path.join(contentRoot, entry.name))
      .sort();
  }

  function fileToDocId(file: string): string {
    return path.basename(file).replace(CONTENT_EXTENSION, '').replace(ORDER_PREFIX, '');
  }

  function readSidebarIds(): Set<string> {
    const sidebarPath = path.resolve(root, sidebarFile);
    if (!fs.existsSync(sidebarPath)) return new Set();
    const source = fs.readFileSync(sidebarPath, 'utf8');
    return new Set([...source.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]));
  }

  function build(): { records: DocsRecord[]; files: string[] } {
    const files = listContentFiles();
    const records = files.map((file) => ({
      ...extractDocument(fs.readFileSync(file, 'utf8'), fileToDocId(file)),
      file: path.relative(root, file).replace(/\\/g, '/'),
    }));

    if (warnOnOrphans) {
      const known = readSidebarIds();
      for (const record of records) {
        if (!known.has(record.docId)) {
          console.warn(
            `[docs-index] ${record.file} has no entry with id '${record.docId}' in ${sidebarFile} — ` +
              `it will be searchable but unreachable from the navigation.`,
          );
        }
      }
    }

    return { records, files };
  }

  return {
    name: 'docs-index',

    configResolved(config) {
      root = config.root;
      contentRoot = path.resolve(root, contentDir);
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },

    load(id) {
      if (id !== RESOLVED_ID) return null;

      const { records, files } = build();
      // Track every content file so a save invalidates this module in dev.
      for (const file of files) this.addWatchFile(file);

      return [
        `export const docsIndex = ${JSON.stringify(records)};`,
        `export const contentFiles = ${JSON.stringify(files.map((f) => path.relative(root, f).replace(/\\/g, '/')))};`,
      ].join('\n');
    },

    handleHotUpdate({ file, server }: { file: string; server: ViteDevServer }) {
      const resolved = path.resolve(file);
      if (!CONTENT_EXTENSION.test(resolved)) return;
      if (!resolved.startsWith(contentRoot)) return;

      const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
      if (!mod) return;
      server.moduleGraph.invalidateModule(mod);
      return [mod];
    },
  };
}
