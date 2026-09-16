/**
 * The token binding.
 *
 * One place maps the diagram's vocabulary onto the theme's tokens, so the
 * renderer, Mermaid and the canonical export cannot drift apart:
 *
 *  - roles (`--color-*`) are oklch and resolve live in CSS;
 *  - the hex `--diagram-*` palette exists because Mermaid's colour library
 *    predates oklch, so anything needing a concrete value reads it there.
 */

import { readToken } from '../css-tokens';
import { presetForScheme, type ColorScheme, type ThemePreset } from '../../theme/presets';
import type { Tone } from './types';

/** Token each tone resolves through. */
export const TONE_TOKEN: Record<Tone, string> = {
  neutral: '--color-neutral',
  info: '--color-info',
  primary: '--color-primary',
  secondary: '--color-secondary',
  success: '--color-success',
  warning: '--color-warning',
  error: '--color-error',
};

export function toneVar(tone: Tone): string {
  return `var(${TONE_TOKEN[tone]})`;
}

export interface DiagramPalette {
  surface: string;
  node: string;
  nodeAlt: string;
  text: string;
  border: string;
  line: string;
  accent: string;
  fontSans: string;
  fontMono: string;
}

/**
 * Concrete colours for renderers that cannot read a CSS variable. Fallbacks
 * match the light preset so a render that lands before the tokens resolve still
 * draws a diagram rather than a blank one.
 */
export function readDiagramPalette(): DiagramPalette {
  return {
    surface: readToken('--diagram-surface', '#fcfdfe'),
    node: readToken('--diagram-node', '#f4f6f8'),
    nodeAlt: readToken('--diagram-node-alt', '#e7eaed'),
    text: readToken('--diagram-text', '#161b21'),
    border: readToken('--diagram-border', '#b9bec6'),
    line: readToken('--diagram-line', '#838a92'),
    accent: readToken('--diagram-accent', '#9a3c00'),
    fontSans: readToken('--font-sans', 'system-ui, sans-serif'),
    fontMono: readToken('--font-mono', 'ui-monospace, monospace'),
  };
}

export function readTones(): Record<Tone, string> {
  const tones = {} as Record<Tone, string>;
  for (const [tone, token] of Object.entries(TONE_TOKEN) as [Tone, string][]) {
    tones[tone] = readToken(token, '#838a92');
  }
  return tones;
}

export interface DiagramTheme {
  scheme: ColorScheme;
  label: string;
  palette: DiagramPalette;
  tones: Record<Tone, string>;
}

/**
 * Both schemes, each read from the preset registered for it.
 *
 * The preset's block only applies while its attributes sit on the document
 * root, so they are borrowed and handed straight back inside one synchronous
 * task — the browser cannot paint in between, and the reactive theme store
 * keeps its own state, so nothing is disturbed. Adding a preset therefore
 * updates the exported SVG without touching the exporter.
 */
export function readDiagramThemes(): DiagramTheme[] {
  const schemes: ColorScheme[] = ['light', 'dark'];
  const themes: DiagramTheme[] = [];

  for (const scheme of schemes) {
    const preset = presetForScheme(scheme);
    themes.push({
      scheme,
      label: preset.label,
      ...withPreset(preset, () => ({ palette: readDiagramPalette(), tones: readTones() })),
    });
  }

  return themes;
}

function withPreset<T>(preset: ThemePreset, read: () => T): T {
  const root = document.documentElement;
  const previous = {
    theme: root.getAttribute('data-theme'),
    scheme: root.getAttribute('data-color-scheme'),
    style: root.style.colorScheme,
  };

  root.setAttribute('data-theme', preset.name);
  root.setAttribute('data-color-scheme', preset.colorScheme);
  root.style.colorScheme = preset.colorScheme;

  try {
    return read();
  } finally {
    restoreAttribute(root, 'data-theme', previous.theme);
    restoreAttribute(root, 'data-color-scheme', previous.scheme);
    root.style.colorScheme = previous.style;
  }
}

function restoreAttribute(root: HTMLElement, name: string, value: string | null): void {
  if (value === null) root.removeAttribute(name);
  else root.setAttribute(name, value);
}
