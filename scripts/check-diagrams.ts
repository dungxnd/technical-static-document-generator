/**
 * Structural gate for hand-authored diagram specs.
 *
 * Reads every `const NAME = [...]` literal out of the .svx content files and
 * runs the same validator the canvas runs in dev. Structure (ids, endpoints,
 * boundaries) is checked exactly; geometry is checked against estimated node
 * boxes because only the browser knows how wide a given title rendered — so
 * geometry findings are reported as estimates and never fail the run.
 *
 * Run with `bun run check:diagrams`.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { validateDiagram, countBySeverity } from '../src/lib/diagram/validate.ts';
import type { ArchBoundary, ArchConnection, ArchNode, Box, DiagramDiagnostic, Rect } from '../src/lib/diagram/types.ts';

/** `.arch-canvas` floors at 620px wide by 14rem tall; specs are authored against it. */
const REFERENCE_FRAME = { width: 620, height: 224 };
const CONTENT_DIR = path.resolve(import.meta.dirname, '../src/content');

interface Spec {
  variable: string;
  nodes: ArchNode[];
  connections: ArchConnection[];
  boundaries: ArchBoundary[];
}

interface FileReport {
  file: string;
  specs: Spec[];
  skipped: string[];
}

const ISSUE_ORDER = { error: 0, warning: 1 } as const;

async function main(): Promise<void> {
  const files = await contentFiles();
  if (files.length === 0) {
    console.log('check:diagrams — no content files found.');
    return;
  }

  let errors = 0;
  let warnings = 0;
  let specCount = 0;
  const reports: FileReport[] = [];

  for (const file of files) {
    const report = await readSpecs(file);
    if (report.specs.length === 0 && report.skipped.length === 0) continue;
    reports.push(report);
  }

  console.log(`check:diagrams — ${reports.length} content file(s) with diagram specs\n`);

  for (const report of reports) {
    console.log(path.relative(process.cwd(), report.file));

    for (const skipped of report.skipped) {
      console.log(`  skipped  ${skipped}`);
    }

    for (const spec of report.specs) {
      specCount += 1;
      const diagnostics = validateSpec(spec);
      const totals = countBySeverity(diagnostics);
      errors += totals.errors;
      warnings += totals.warnings;

      const summary = `${spec.nodes.length} node(s), ${spec.connections.length} connection(s), ${spec.boundaries.length} boundary/ies`;
      console.log(`  ${spec.variable} — ${summary}`);

      if (diagnostics.length === 0) {
        console.log('    ok');
        continue;
      }

      const sorted = [...diagnostics].sort((a, b) => ISSUE_ORDER[a.severity] - ISSUE_ORDER[b.severity]);
      for (const diagnostic of sorted) {
        console.log(`    ${diagnostic.severity.padEnd(7)} ${diagnostic.code.padEnd(28)} ${diagnostic.message}`);
      }
    }

    console.log('');
  }

  const verdict = errors > 0 ? 'FAIL' : 'PASS';
  console.log(`${verdict} — ${specCount} spec(s), ${errors} error(s), ${warnings} warning(s)`);
  if (warnings > 0) {
    console.log('Geometry warnings use estimated box sizes; the canvas reports the measured truth.');
  }

  process.exitCode = errors > 0 ? 1 : 0;
}

async function contentFiles(): Promise<string[]> {
  const entries = await readdir(CONTENT_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.svx'))
    .map((entry) => path.join(CONTENT_DIR, entry.name))
    .sort();
}

async function readSpecs(file: string): Promise<FileReport> {
  const source = await readFile(file, 'utf8');
  const report: FileReport = { file, specs: [], skipped: [] };
  const candidates: Candidate[] = [];

  for (const literal of extractArrayLiterals(source)) {
    let value: unknown;
    try {
      value = evaluate(literal.literal);
    } catch {
      report.skipped.push(`${literal.name} — the literal is not plain data, left to the runtime check`);
      continue;
    }

    if (!Array.isArray(value) || value.length === 0) continue;
    const kind = classify(value);
    if (kind) candidates.push({ name: literal.name, items: value, kind });
  }

  const specs: Spec[] = candidates
    .filter((candidate) => candidate.kind === 'nodes')
    .map((candidate) => ({
      variable: candidate.name,
      nodes: candidate.items as ArchNode[],
      connections: [],
      boundaries: [],
    }));

  // Nothing in the source ties the arrays of one diagram together, so they are
  // paired by ownership: a connection belongs to the spec that declares its
  // endpoints, a boundary to the spec that declares the nodes it wraps.
  for (const candidate of candidates) {
    if (candidate.kind === 'nodes') continue;

    const ids = candidate.kind === 'connections'
      ? (candidate.items as ArchConnection[]).flatMap((item) => [item.from, item.to])
      : (candidate.items as ArchBoundary[]).flatMap((item) => item.wraps ?? []);

    const owner = bestOwner(specs, ids);
    if (!owner) {
      report.skipped.push(`${candidate.name} — no diagram in this file declares its endpoints`);
      continue;
    }

    if (candidate.kind === 'connections') owner.connections = candidate.items as ArchConnection[];
    else owner.boundaries = candidate.items as ArchBoundary[];
  }

  report.specs = specs.filter((spec) => spec.nodes.length > 0);
  return report;
}

/** The spec that declares the most of the given ids; ties go to the first. */
function bestOwner(specs: Spec[], ids: string[]): Spec | null {
  let best: Spec | null = null;
  let bestScore = 0;

  for (const spec of specs) {
    const declared = new Set(spec.nodes.map((node) => node.id));
    const score = ids.filter((id) => declared.has(id)).length;
    if (score > bestScore) {
      bestScore = score;
      best = spec;
    }
  }

  return best;
}

interface Candidate {
  name: string;
  items: unknown[];
  kind: 'nodes' | 'connections' | 'boundaries';
}

/**
 * Specs are plain data literals, so they can be evaluated directly. The only
 * TypeScript inside them is a trailing type assertion — `as const`, `as const`
 * on a field, or a tuple assertion such as `as [number, number][]`.
 */
function evaluate(literal: string): unknown {
  const cleaned = literal
    .replace(TYPE_ASSERTION, '')
    .replace(/,(\s*[\]}])/g, '$1');
  return new Function(`return (${cleaned});`)() as unknown;
}

const TYPE_ASSERTION =
  /\s+as\s+(?:const|\[[^\]]*\]\[\]|\[[^\]]*\]|[A-Za-z_$][\w$]*(?:<[^>]*>)?(?:\[\])?)\s*(?=[,}\]\n]|$)/g;

function classify(items: unknown[]): 'nodes' | 'connections' | 'boundaries' | null {
  const first = items[0];
  if (!first || typeof first !== 'object') return null;
  const keys = Object.keys(first as Record<string, unknown>);
  if (keys.includes('from') && keys.includes('to')) return 'connections';
  if (keys.includes('kind') && keys.includes('wraps')) return 'boundaries';
  if (keys.includes('id') && keys.includes('x') && keys.includes('y')) return 'nodes';
  return null;
}

interface ArrayLiteral {
  name: string;
  literal: string;
}

function extractArrayLiterals(source: string): ArrayLiteral[] {
  const found: ArrayLiteral[] = [];
  const declaration = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g;

  let match: RegExpExecArray | null;
  while ((match = declaration.exec(source)) !== null) {
    const start = match.index + match[0].length - 1;
    const end = matchBracket(source, start);
    if (end === -1) continue;
    found.push({ name: match[1], literal: source.slice(start, end + 1) });
    declaration.lastIndex = end;
  }

  return found;
}

/** Bracket matching that ignores brackets inside strings, templates and comments. */
function matchBracket(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * Estimated boxes, so the composition checks have something to reason about
 * outside the browser. Deliberately generous: an estimate must not manufacture
 * failures, so a small error budget is added to every box.
 */
function estimateBoxes(nodes: ArchNode[]): Record<string, Box> {
  const boxes: Record<string, Box> = {};

  for (const node of nodes) {
    const title = node.title?.length ?? 0;
    const subtitle = node.subtitle?.length ?? 0;
    const textWidth = Math.max(title * 6.6, subtitle * 6.0);
    const width = Math.min(textWidth + 52, 216);
    const height = node.subtitle ? 43 : 38;

    boxes[node.id] = {
      centreX: (node.x / 100) * REFERENCE_FRAME.width,
      centreY: (node.y / 100) * REFERENCE_FRAME.height,
      halfWidth: width / 2,
      halfHeight: height / 2,
    };
  }

  return boxes;
}

/** Label chips are one line of 10px mono plus padding, centred on the anchor. */
function estimateLabels(connections: ArchConnection[], boxes: Record<string, Box>): Record<string, Rect> {
  const labels: Record<string, Rect> = {};
  const frame = REFERENCE_FRAME;

  for (const connection of connections) {
    if (!connection.label) continue;
    const from = boxes[connection.from];
    const to = boxes[connection.to];
    if (!from || !to) continue;

    const anchor = connection.labelAt
      ? { x: (connection.labelAt[0] / 100) * frame.width, y: (connection.labelAt[1] / 100) * frame.height }
      : { x: (from.centreX + to.centreX) / 2, y: (from.centreY + to.centreY) / 2 };

    const width = connection.label.length * 6.05 + 10;
    const height = 16;
    labels[connection.id ?? `${connection.from}->${connection.to}`] = {
      x: anchor.x - width / 2,
      y: anchor.y - height / 2,
      width,
      height,
    };
  }

  return labels;
}

function validateSpec(spec: Spec): DiagramDiagnostic[] {
  const boxes = estimateBoxes(spec.nodes);
  return validateDiagram({
    nodes: spec.nodes,
    connections: spec.connections,
    boundaries: spec.boundaries,
    boxes,
    authoredBoxes: boxes,
    labels: estimateLabels(spec.connections, boxes),
    frame: REFERENCE_FRAME,
  });
}

await main();
