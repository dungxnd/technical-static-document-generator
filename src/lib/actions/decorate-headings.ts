import type { DocsHeading } from 'virtual:docs-index';
import { uniqueSlug } from '../slugify';

/**
 * Shapes the document for the reader: stable heading ids, linkable anchors and
 * the outline the TOC rail renders.
 *
 * Ids come from the same `uniqueSlug` walk the build-time index uses, over the
 * same plain text in the same order, so `#/doc/heading-slug` resolves to the
 * heading the search result promised.
 */
export function decorateHeadings(root: HTMLElement, docId: string): DocsHeading[] {
  const elements = root.querySelectorAll<HTMLElement>('h1, h2, h3, h4');
  const seen = new Set<string>();
  const outline: DocsHeading[] = [];

  for (const element of elements) {
    if (element.dataset.headingDecorated === 'true') continue;

    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const id = uniqueSlug(text, seen);
    const level = Number(element.tagName.slice(1));

    element.id = id;
    element.dataset.headingDecorated = 'true';
    outline.push({ id, text, level });

    const anchor = document.createElement('a');
    anchor.className = 'heading-anchor';
    anchor.href = `#/${docId}/${id}`;
    anchor.textContent = '#';
    anchor.setAttribute('aria-label', `Link to ${text}`);
    element.appendChild(anchor);
  }

  return outline;
}

/** Scrolls a heading into view without fighting the sticky header. */
export function scrollToSection(sectionId: string): boolean {
  const target = document.getElementById(sectionId);
  if (!target) return false;
  target.scrollIntoView({ block: 'start', behavior: 'auto' });
  return true;
}
