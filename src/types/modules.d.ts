declare module '*.svx' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, unknown>>;
  export default component;
  export const metadata: Record<string, unknown>;
}

declare module '*.svelte.md' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, unknown>>;
  export default component;
  export const metadata: Record<string, unknown>;
}

declare module '*.md' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, unknown>>;
  export default component;
  export const metadata: Record<string, unknown>;
}

declare module 'virtual:docs-index' {
  export interface DocsHeading {
    id: string;
    text: string;
    level: number;
    /**
     * Plain text between this heading and the next — used for result snippets.
     * Emitted by the build-time index; the client-side DOM walk omits it.
     */
    body?: string;
  }

  /** Built at build time by vite-plugins/docs-index.ts from src/content/**. */
  export interface DocsRecord {
    docId: string;
    file: string;
    title: string;
    headings: DocsHeading[];
    /** Document body with markdown and component markup stripped. */
    text: string;
  }

  export const docsIndex: DocsRecord[];
  export const contentFiles: string[];
}
