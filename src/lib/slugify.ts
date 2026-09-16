/**
 * The slug contract.
 *
 * Imported by BOTH the Node-side docs index plugin (vite-plugins/docs-index.ts)
 * and the browser-side heading decorator (src/lib/actions/decorate-headings.ts).
 * Heading ids only line up between a search result and the rendered document
 * because both sides run this exact function over the same plain text, in the
 * same source order.
 *
 * Keep this module dependency-free and side-effect-free so it stays safe to
 * import from a Vite config.
 */

/** Inline markdown that changes the source text but not the rendered text. */
const INLINE_MARKDOWN = /[`*_~]/g;
const HTML_ENTITY = /&(?:[a-z]+|#\d+);/gi;
/** `1. Heading`, `2) Heading`, `3: Heading` — list numbering is not part of the name. */
const LEADING_ENUMERATION = /^\s*\d+\s*[.):]\s+/;
const LEADING_TRAILING_DASH = /^-+|-+$/g;
const REPEATED_DASH = /-+/g;
const NON_SLUG = /[^\p{L}\p{N}\s-]/gu;
const WHITESPACE = /\s+/g;

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(INLINE_MARKDOWN, '')
    .replace(HTML_ENTITY, '')
    .replace(LEADING_ENUMERATION, '')
    .toLowerCase()
    .trim()
    .replace(NON_SLUG, '')
    .replace(WHITESPACE, '-')
    .replace(REPEATED_DASH, '-')
    .replace(LEADING_TRAILING_DASH, '');
}

/**
 * Deterministic de-duplication. Both callers walk headings in document order,
 * so feeding them the same heading texts yields the same suffixes.
 */
export function uniqueSlug(text: string, seen: Set<string>): string {
  const base = slugify(text) || 'section';
  let candidate = base;
  let counter = 1;
  while (seen.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  seen.add(candidate);
  return candidate;
}
