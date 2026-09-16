import { allDocItems, defaultDocItem, findDocItem, type DocItem } from '../config/sidebar';

export interface Route {
  /** Document id, always resolved to a real entry unless `unknown` is set. */
  docId: string;
  /** Heading slug within the document, or null for the top of the page. */
  section: string | null;
  /** True when the hash named a document that does not exist. */
  unknown: boolean;
}

export function docHref(docId: string, section?: string | null): string {
  return section ? `#/${docId}/${section}` : `#/${docId}`;
}

/**
 * Hash grammar: `#/<docId>[/<sectionSlug>]`
 *
 * A single path level is reserved for the document so heading anchors can
 * never be mistaken for a route.
 */
export function parseHash(hash: string): Route {
  const path = (hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');
  if (!path) {
    return { docId: defaultDocItem.id, section: null, unknown: false };
  }

  const [rawDocId, ...rest] = path.split('/');
  const docId = decodeURIComponent(rawDocId);
  const rawSection = rest.join('/');
  const section = rawSection ? decodeURIComponent(rawSection) : null;

  if (!findDocItem(docId)) {
    return { docId: defaultDocItem.id, section: null, unknown: true };
  }
  return { docId, section, unknown: false };
}

export interface DocNeighbours {
  prev: DocItem | null;
  next: DocItem | null;
  index: number;
  total: number;
}

/** Reading order neighbours, derived from the sidebar so they never drift. */
export function docNeighbours(docId: string): DocNeighbours {
  const index = allDocItems.findIndex((item) => item.id === docId);
  if (index === -1) {
    return { prev: null, next: null, index: -1, total: allDocItems.length };
  }
  return {
    prev: allDocItems[index - 1] ?? null,
    next: allDocItems[index + 1] ?? null,
    index,
    total: allDocItems.length,
  };
}
