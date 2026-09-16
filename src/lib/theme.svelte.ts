import {
  presets,
  themeStoreKey,
  getPreset,
  systemPreferredPreset,
  type ColorScheme,
  type ThemePreset,
} from '../theme/presets';

function readInitialPreset(): ThemePreset {
  const fromDom = getPreset(document.documentElement.getAttribute('data-theme'));
  return fromDom ?? systemPreferredPreset();
}

let current = $state<ThemePreset>(readInitialPreset());

function apply(preset: ThemePreset) {
  const root = document.documentElement;
  root.setAttribute('data-theme', preset.name);
  root.setAttribute('data-color-scheme', preset.colorScheme);
  root.style.colorScheme = preset.colorScheme;

  // Keep the mobile browser chrome in step with the active surface, read
  // straight from the token so it can never drift from the preset.
  const meta = document.querySelector('meta[name="theme-color"]');
  const surface = getComputedStyle(root).getPropertyValue('--color-base-100').trim();
  if (meta && surface) meta.setAttribute('content', surface);
}

export const theme = {
  get current(): ThemePreset {
    return current;
  },
  get name(): string {
    return current.name;
  },
  get label(): string {
    return current.label;
  },
  get colorScheme(): ColorScheme {
    return current.colorScheme;
  },
  get isDark(): boolean {
    return current.colorScheme === 'dark';
  },
  get available(): ThemePreset[] {
    return presets;
  },

  set(name: string) {
    const preset = getPreset(name);
    if (!preset || preset.name === current.name) return;
    current = preset;
    apply(preset);
    try {
      localStorage.setItem(themeStoreKey, preset.name);
    } catch {
      /* private mode / storage disabled — theme still applies for this session */
    }
  },

  /** Flip to the first preset with the opposite colour scheme. */
  toggle() {
    const next = presets.find((preset) => preset.colorScheme !== current.colorScheme);
    if (next) this.set(next.name);
  },

  /** Keep the module in step with a change made outside it (e.g. the tab switcher). */
  syncFromDom() {
    const preset = getPreset(document.documentElement.getAttribute('data-theme'));
    if (preset) current = preset;
  },
};
