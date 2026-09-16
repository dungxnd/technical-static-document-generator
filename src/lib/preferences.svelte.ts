export type ContentWidth = 'readable' | 'wide';

const STORAGE_KEY = 'content-width';

function readInitial(): ContentWidth {
  const fromDom = document.documentElement.dataset.contentWidth;
  if (fromDom === 'readable' || fromDom === 'wide') return fromDom;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'wide' ? 'wide' : 'readable';
  } catch {
    return 'readable';
  }
}

let width = $state<ContentWidth>(readInitial());

function apply(value: ContentWidth) {
  document.documentElement.dataset.contentWidth = value;
}

export const preferences = {
  get contentWidth(): ContentWidth {
    return width;
  },
  get isWide(): boolean {
    return width === 'wide';
  },

  setContentWidth(value: ContentWidth) {
    if (value === width) return;
    width = value;
    apply(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* storage unavailable — the choice still holds for this session */
    }
  },

  /** Readable measure ↔ full-bleed content. */
  toggleContentWidth() {
    this.setContentWidth(width === 'wide' ? 'readable' : 'wide');
  },

  /** Keep the module in step with the pre-paint attribute. */
  syncFromDom() {
    const value = document.documentElement.dataset.contentWidth;
    if (value === 'readable' || value === 'wide') width = value;
  },
};
