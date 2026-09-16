export type ColorScheme = 'light' | 'dark';

export interface ThemePreset {
  /** Must match `name` in the corresponding `@plugin "daisyui/theme"` block. */
  name: string;
  label: string;
  colorScheme: ColorScheme;
}

/**
 * The theme registry. Adding a preset is two steps:
 *   1. add a `@plugin "daisyui/theme" { name: "…" }` block in tokens.css
 *   2. add a row here
 * No component needs to change.
 */
export const presets: ThemePreset[] = [
  { name: 'blueprint', label: 'Blueprint', colorScheme: 'light' },
  { name: 'blueprint-dark', label: 'Blueprint dark', colorScheme: 'dark' },
];

/** Used when nothing is stored and the OS expresses no preference. */
export const defaultPresetName = 'blueprint';

export const themeStoreKey = 'theme';

const byName = new Map(presets.map((preset) => [preset.name, preset]));

export function getPreset(name: string | null | undefined): ThemePreset | undefined {
  return name ? byName.get(name) : undefined;
}

export function isKnownTheme(name: string | null | undefined): name is string {
  return getPreset(name) !== undefined;
}

export function presetForScheme(scheme: ColorScheme): ThemePreset {
  return (
    presets.find((preset) => preset.colorScheme === scheme) ??
    getPreset(defaultPresetName) ??
    presets[0]
  );
}

/**
 * The preset to use when the visitor has no stored choice: mirror the OS
 * preference when a preset covers it, otherwise fall back to the default.
 */
export function systemPreferredPreset(): ThemePreset {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return presetForScheme('dark');
  }
  return getPreset(defaultPresetName) ?? presets[0];
}
