/**
 * Canonical export.
 *
 * The export is rebuilt from the spec and the measured layout rather than
 * copied out of the DOM: the frame's nodes are HTML boxes whose styles do not
 * survive serialisation, and a screenshot would carry viewer state with it.
 * Rebuilding means selection, focus rings, the fitted pan/zoom transform, the
 * dev overlay and the grid background are absent by construction.
 *
 * Every measurement it needs was already taken by the renderer, so an exported
 * SVG matches the diagram on screen without re-measuring anything.
 */

import { slugify } from '../slugify';
import type { DiagramPalette, DiagramTheme } from './palette';
import type { RoutedConnection } from './geometry';
import {
  BOUNDARY_META,
  type BoundaryKind,
  type Box,
  type NodeType,
  type NodeVariant,
  type Point,
  type Rect,
  type Tone,
} from './types';

export interface ExportNode {
  id: string;
  title: string;
  subtitle?: string;
  type?: NodeType;
  variant: NodeVariant;
  tone: Tone;
  /** Measured box, in canvas px. */
  box: Box;
}

export interface ExportBoundary {
  id: string;
  label: string;
  kind: BoundaryKind;
  rect: Rect;
}

export interface ExportLegendEntry {
  label: string;
  tone: Tone;
  count: number;
}

export interface ExportInput {
  title: string;
  description?: string;
  nodes: ExportNode[];
  connections: RoutedConnection[];
  boundaries: ExportBoundary[];
  legend?: ExportLegendEntry[];
  /**
   * Themes to embed: one writes the live palette, two write the diagram twice
   * behind a `prefers-color-scheme` query so the file reads correctly in either
   * theme from a README or an email.
   */
  themes: DiagramTheme[];
}

const PAD = 26;
const HEADER = 30;
const LEGEND_ROW = 22;
const LABEL_HEIGHT = 16;
/** Advance of the 10px mono label chip, used only to size its background. */
const LABEL_CHAR = 6.05;
const LABEL_PAD = 10;
const MIN_WIDTH = 360;

export function buildDiagramSvg(input: ExportInput): string {
  const bounds = contentBounds(input);
  const contentWidth = Math.ceil(bounds.width);
  const width = Math.max(contentWidth + PAD * 2, MIN_WIDTH);
  const legendHeight = input.legend?.length ? LEGEND_ROW + 10 : 0;
  const height = HEADER + PAD + Math.ceil(bounds.height) + PAD + legendHeight;

  const offset: Point = { x: PAD - bounds.x, y: HEADER + PAD - bounds.y };
  const themeGroups = input.themes
    .map((theme, index) => renderTheme(input, theme, index, width, height, offset))
    .join('\n');

  const style =
    input.themes.length > 1
      ? `<style>
    .arch-theme { display: inline; }
    ${input.themes
      .map((theme, index) => `.arch-theme-${index} { display: ${index === 0 ? 'inline' : 'none'}; }`)
      .join('\n    ')}
    ${input.themes
      .map(
        (theme, index) =>
          `@media (prefers-color-scheme: ${theme.scheme}) { .arch-theme-${index} { display: inline; } .arch-theme-${(index + 1) % input.themes.length} { display: none; } }`,
      )
      .join('\n    ')}
  </style>`
      : '';

  const description =
    input.description ??
    `${input.nodes.length} components and ${input.connections.length} relationships.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(input.title)}">
  <title>${esc(input.title)}</title>
  <desc>${esc(description)}</desc>
  ${style}
${themeGroups}
</svg>`;
}

function renderTheme(
  input: ExportInput,
  theme: DiagramTheme,
  index: number,
  width: number,
  height: number,
  offset: Point,
): string {
  const { palette, tones } = theme;
  const markers = new MarkerRegistry(index, palette.line);
  const legend = input.legend ?? [];
  const legendHeight = legend.length ? LEGEND_ROW + 10 : 0;

  const parts: string[] = [];
  parts.push(`  <g class="arch-theme arch-theme-${index}">`);
  parts.push(
    `    <rect x="0" y="0" width="${width}" height="${height}" fill="${palette.surface}" />`,
  );
  parts.push(renderHeader(input.title, palette, width));

  parts.push(`    <g transform="translate(${num(offset.x)} ${num(offset.y)})">`);
  for (const boundary of input.boundaries) {
    parts.push(renderBoundary(boundary, palette, tones));
  }
  for (const connection of input.connections) {
    parts.push(...renderConnection(connection, palette, tones, markers));
  }
  for (const connection of input.connections) {
    if (connection.label) parts.push(renderLabel(connection, palette));
  }
  for (const node of input.nodes) {
    parts.push(...renderNode(node, palette, tones));
  }
  parts.push('    </g>');

  if (legend.length) {
    parts.push(renderLegend(legend, palette, tones, PAD, height - legendHeight + 4));
  }

  parts.push(markers.render());
  parts.push('  </g>');
  return parts.join('\n');
}

function renderHeader(title: string, palette: DiagramPalette, width: number): string {
  return [
    `    <text x="${PAD}" y="${HEADER - 14}" font-family="${esc(palette.fontMono)}" font-size="11" letter-spacing="0.77" fill="${palette.text}" fill-opacity="0.62">${esc(title.toUpperCase())}</text>`,
    `    <line x1="${PAD}" y1="${HEADER - 8}" x2="${width - PAD}" y2="${HEADER - 8}" stroke="${palette.border}" stroke-width="1" />`,
  ].join('\n');
}

function renderBoundary(
  boundary: ExportBoundary,
  palette: DiagramPalette,
  tones: Record<Tone, string>,
): string {
  const meta = BOUNDARY_META[boundary.kind];
  const stroke = boundary.kind === 'security-group' ? tones[meta.tone] : palette.border;
  const { rect } = boundary;
  const labelWidth = boundary.label.length * LABEL_CHAR + 8;

  return [
    `      <rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.width)}" height="${num(rect.height)}" rx="6" fill="none" stroke="${stroke}" stroke-width="1" stroke-dasharray="6 4" />`,
    `      <rect x="${num(rect.x + 5)}" y="${num(rect.y + 4)}" width="${num(labelWidth)}" height="13" fill="${palette.surface}" />`,
    `      <text x="${num(rect.x + 8)}" y="${num(rect.y + 14)}" font-family="${esc(palette.fontMono)}" font-size="9" letter-spacing="0.5" fill="${stroke}">${esc(boundary.label.toUpperCase())}</text>`,
  ].join('\n');
}

function renderConnection(
  connection: RoutedConnection,
  palette: DiagramPalette,
  tones: Record<Tone, string>,
  markers: MarkerRegistry,
): string[] {
  const variant = connection.variant;
  const color =
    connection.color ??
    (variant === 'emphasis' ? palette.accent : variant === 'security' ? tones.error : palette.line);
  const dash = variant === 'dashed' ? ' stroke-dasharray="5 5"' : '';
  const width = variant === 'emphasis' ? connection.width * 1.6 : connection.width;
  const markerEnd = ` marker-end="url(#${markers.end(color)})"`;
  const markerStart = connection.bidirectional ? ` marker-start="url(#${markers.start(color)})"` : '';

  return [
    `      <path d="${connection.d}" fill="none" stroke="${color}" stroke-width="${num(width)}"${dash}${markerEnd}${markerStart} />`,
  ];
}

function renderLabel(connection: RoutedConnection, palette: DiagramPalette): string {
  const width = connection.label.length * LABEL_CHAR + LABEL_PAD;
  const centre = connection.labelPoint;
  const x = centre.x - width / 2;
  const y = connection.labelPlacement === 'above' ? centre.y - LABEL_HEIGHT : centre.y - LABEL_HEIGHT / 2;

  return [
    `      <rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${LABEL_HEIGHT}" rx="3" fill="${palette.surface}" stroke="${palette.border}" stroke-width="1" />`,
    `      <text x="${num(centre.x)}" y="${num(y + 11)}" text-anchor="middle" font-family="${esc(palette.fontMono)}" font-size="10" fill="${palette.text}" fill-opacity="0.72">${esc(connection.label)}</text>`,
  ].join('\n');
}

function renderNode(
  node: ExportNode,
  palette: DiagramPalette,
  tones: Record<Tone, string>,
): string[] {
  const rect = {
    x: node.box.centreX - node.box.halfWidth,
    y: node.box.centreY - node.box.halfHeight,
    width: node.box.halfWidth * 2,
    height: node.box.halfHeight * 2,
  };

  let stroke = palette.border;
  let dash = '';
  if (node.variant === 'emphasis') stroke = palette.accent;
  else if (node.variant === 'security') {
    stroke = tones.error;
    dash = ' stroke-dasharray="4 3"';
  } else if (node.variant === 'dashed') dash = ' stroke-dasharray="4 3"';

  const textX = rect.x + 13;
  const centreY = rect.y + rect.height / 2;
  const maxChars = Math.max(Math.floor((rect.width - 26) / 6.6), 6);
  const titleLines = wrapTitle(node.title, maxChars);

  const lines: string[] = [
    `      <rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.width)}" height="${num(rect.height)}" rx="4" fill="${palette.node}" stroke="${stroke}" stroke-width="1"${dash} />`,
    `      <rect x="${num(rect.x)}" y="${num(rect.y)}" width="3" height="${num(rect.height)}" fill="${tones[node.tone]}" />`,
  ];

  // The title block is centred on the measured box, so the export keeps the
  // proportions the browser laid out even when the title wrapped.
  const titleBlock = titleLines.length * 14;
  const hasSubtitle = Boolean(node.subtitle);
  const titleTop = centreY - titleBlock / 2 + (hasSubtitle ? -1 : 4.5);

  for (const [index, line] of titleLines.entries()) {
    lines.push(
      `      <text x="${num(textX)}" y="${num(titleTop + index * 14)}" font-family="${esc(palette.fontSans)}" font-size="12" font-weight="620" fill="${palette.text}">${esc(line)}</text>`,
    );
  }

  if (node.subtitle) {
    lines.push(
      `      <text x="${num(textX)}" y="${num(titleTop + titleBlock + 7)}" font-family="${esc(palette.fontMono)}" font-size="10" fill="${palette.text}" fill-opacity="0.58">${esc(node.subtitle)}</text>`,
    );
  }

  return lines;
}

/** Wraps onto at most two lines, matching the box the browser already sized. */
function wrapTitle(title: string, maxChars: number): string[] {
  if (title.length <= maxChars) return [title];

  const words = title.split(' ');
  const first = words.shift() ?? '';
  let line = first;
  let second = '';

  for (const word of words) {
    if (!second && `${line} ${word}`.length <= maxChars) line = `${line} ${word}`;
    else second = second ? `${second} ${word}` : word;
  }

  return second ? [line, second] : [line];
}

function renderLegend(
  legend: ExportLegendEntry[],
  palette: DiagramPalette,
  tones: Record<Tone, string>,
  x: number,
  y: number,
): string {
  const parts: string[] = [];
  let cursor = x;

  for (const entry of legend) {
    parts.push(
      `    <rect x="${num(cursor)}" y="${num(y)}" width="8" height="8" rx="2" fill="${tones[entry.tone]}" />`,
    );
    const label = `${entry.label} ×${entry.count}`;
    parts.push(
      `    <text x="${num(cursor + 13)}" y="${num(y + 8)}" font-family="${esc(palette.fontMono)}" font-size="10" fill="${palette.text}" fill-opacity="0.7">${esc(label)}</text>`,
    );
    cursor += 13 + label.length * LABEL_CHAR + 16;
  }

  return parts.join('\n');
}

/**
 * One marker per stroke colour, because `context-stroke` is not dependable
 * outside a live document.
 */
class MarkerRegistry {
  private ids = new Map<string, number>();
  private defs: string[] = [];

  constructor(
    private readonly prefix: number,
    private readonly defaultColor: string,
  ) {
    this.end(defaultColor);
  }

  end(color: string): string {
    return this.register(color, false);
  }

  start(color: string): string {
    return this.register(color, true);
  }

  private register(color: string, reverse: boolean): string {
    const key = `${color}|${reverse ? 'start' : 'end'}`;
    const existing = this.ids.get(key);
    if (existing !== undefined) return `arch-${this.prefix}-marker-${existing}`;

    const index = this.ids.size;
    this.ids.set(key, index);
    const id = `arch-${this.prefix}-marker-${index}`;
    const points = reverse ? '7 0, 0 3.5, 7 7' : '0 0, 7 3.5, 0 7';
    const refX = reverse ? 1 : 6;
    this.defs.push(
      `      <marker id="${id}" markerWidth="7" markerHeight="7" refX="${refX}" refY="3.5" orient="auto"><polygon points="${points}" fill="${color}" /></marker>`,
    );
    return id;
  }

  render(): string {
    if (this.defs.length === 0) return '';
    return `    <defs>\n${this.defs.join('\n')}\n    </defs>`;
  }
}

function contentBounds(input: ExportInput): Rect {
  const rects: Rect[] = [];

  for (const node of input.nodes) {
    rects.push({
      x: node.box.centreX - node.box.halfWidth,
      y: node.box.centreY - node.box.halfHeight,
      width: node.box.halfWidth * 2,
      height: node.box.halfHeight * 2,
    });
  }
  for (const boundary of input.boundaries) rects.push(boundary.rect);
  for (const connection of input.connections) {
    for (const point of connection.points) rects.push({ x: point.x, y: point.y, width: 0, height: 0 });
    if (connection.label) {
      const width = connection.label.length * LABEL_CHAR + LABEL_PAD;
      const y =
        connection.labelPlacement === 'above'
          ? connection.labelPoint.y - LABEL_HEIGHT
          : connection.labelPoint.y - LABEL_HEIGHT / 2;
      rects.push({ x: connection.labelPoint.x - width / 2, y, width, height: LABEL_HEIGHT });
    }
  }

  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function svgFileName(title: string, extension: string): string {
  return `${slugify(title) || 'diagram'}.${extension}`;
}

export function downloadSvgFile(svg: string, filename: string): void {
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

export async function copySvgText(svg: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(svg);
    return true;
  } catch {
    return false;
  }
}

/** Rasterises the same SVG, so the PNG cannot drift from the file export. */
export async function exportPngFile(svg: string, filename: string, scale = 2): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));

  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The diagram could not be rasterised.'));
    });
    image.src = url;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round((image.naturalWidth || 1200) * scale);
    canvas.height = Math.round((image.naturalHeight || 600) * scale);

    const context = canvas.getContext('2d');
    if (!context) throw new Error('The diagram could not be rasterised.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The diagram could not be rasterised.');
    downloadBlob(blob, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
