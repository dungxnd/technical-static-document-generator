import type { Component } from 'svelte';
import type { LucideIcon } from '@lucide/svelte';
import { BookOpen, Layers } from '@lucide/svelte';

export interface DocItem {
  /** Route segment and content filename stem: `src/content/01-<id>.svx`. */
  id: string;
  title: string;
  description?: string;
  badge?: string;
  loader: () => Promise<{ default: Component }>;
}

export interface DocSection {
  title: string;
  /** A real component — not a string the shell has to switch on. */
  icon?: LucideIcon;
  items: DocItem[];
}

/**
 * Single source of truth for navigation order and metadata.
 * Search records, table of contents and prev/next are all derived from this,
 * so adding a document is: drop the .svx file in src/content/ and add an entry.
 */
export const sidebarConfig: DocSection[] = [
  {
    title: 'Getting Started',
    icon: BookOpen,
    items: [
      {
        id: 'architecture',
        title: 'System Architecture',
        description: 'Compiler pipeline, offline architecture & runtime components',
        badge: 'Core',
        loader: () => import('../content/01-architecture.svx'),
      },
    ],
  },
  {
    title: 'API & Schemas',
    icon: Layers,
    items: [
      {
        id: 'api-reference',
        title: 'API Reference',
        description: 'Interactive endpoints, JSON schemas, payload explorer',
        badge: 'v1.0',
        loader: () => import('../content/02-api-reference.svx'),
      },
    ],
  },
];

export const allDocItems: DocItem[] = sidebarConfig.flatMap((section) => section.items);

export const defaultDocItem: DocItem = allDocItems[0];

export function findDocItem(docId: string | null | undefined): DocItem | undefined {
  if (!docId) return undefined;
  return allDocItems.find((item) => item.id === docId);
}

export function sectionOf(docId: string): DocSection | undefined {
  return sidebarConfig.find((section) => section.items.some((item) => item.id === docId));
}
