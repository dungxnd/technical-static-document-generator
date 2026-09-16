<script lang="ts">
  import { onMount } from 'svelte';
  import MiniSearch from 'minisearch';
  import { docsIndex } from 'virtual:docs-index';
  import { allDocItems, sectionOf } from '../../config/sidebar';
  import { docHref } from '../routing';
  import { siteConfig } from '../../config/site';
  import { FileText, Search, X } from '@lucide/svelte';

  interface Props {
    isOpen?: boolean;
  }

  let { isOpen = $bindable(false) }: Props = $props();

  interface PaletteRecord {
    id: string;
    docId: string;
    docTitle: string;
    section: string;
    heading: string;
    anchor: string;
    body: string;
  }

  interface ResultGroup {
    docId: string;
    docTitle: string;
    section: string;
    items: PaletteRecord[];
  }

  const MAX_RESULTS = 24;

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let query = $state('');
  let results = $state<PaletteRecord[]>([]);
  let selectedIndex = $state(0);
  let searchIndex: MiniSearch<PaletteRecord> | null = null;
  /** Whether the current press began on the backdrop rather than inside. */
  let pointerDownOnBackdrop = false;

  /**
   * Built from the build-time content index joined with the sidebar, so a new
   * .svx file becomes searchable the moment it lands — nothing to edit here.
   */
  function buildRecords(): PaletteRecord[] {
    const records: PaletteRecord[] = [];

    for (const doc of allDocItems) {
      const indexed = docsIndex.find((entry) => entry.docId === doc.id);
      const section = sectionOf(doc.id)?.title ?? 'Docs';

      records.push({
        id: doc.id,
        docId: doc.id,
        docTitle: doc.title,
        section,
        heading: '',
        anchor: docHref(doc.id),
        body: indexed?.text ?? '',
      });

      for (const heading of indexed?.headings ?? []) {
        // The h1 is the document itself, already covered above.
        if (heading.level === 1) continue;
        records.push({
          id: `${doc.id}#${heading.id}`,
          docId: doc.id,
          docTitle: doc.title,
          section,
          heading: heading.text,
          anchor: docHref(doc.id, heading.id),
          body: heading.body ?? '',
        });
      }
    }

    return records;
  }

  function ensureIndex(): MiniSearch<PaletteRecord> {
    if (!searchIndex) {
      const index = new MiniSearch<PaletteRecord>({
        idField: 'id',
        fields: ['heading', 'docTitle', 'body'],
        storeFields: ['docId', 'docTitle', 'section', 'heading', 'anchor', 'body'],
        searchOptions: {
          boost: { heading: 3, docTitle: 2 },
          fuzzy: 0.2,
          prefix: true,
        },
      });
      index.addAll(buildRecords());
      searchIndex = index;
    }
    return searchIndex;
  }

  const groups = $derived.by((): ResultGroup[] => {
    const byDoc = new Map<string, ResultGroup>();
    for (const record of results) {
      let group = byDoc.get(record.docId);
      if (!group) {
        group = {
          docId: record.docId,
          docTitle: record.docTitle,
          section: record.section,
          items: [],
        };
        byDoc.set(record.docId, group);
      }
      group.items.push(record);
    }
    return [...byDoc.values()];
  });

  /** Flat order so keyboard movement matches what the eye reads. */
  const flat = $derived(groups.flatMap((group) => group.items));
  const activeTerms = $derived(searchTerms(query));

  // The native <dialog> supplies the focus trap, Esc handling and background
  // inerting, so none of that is hand-rolled here.
  $effect(() => {
    const dialog = dialogEl;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  });

  $effect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => inputEl?.focus());
    return () => cancelAnimationFrame(frame);
  });

  onMount(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        isOpen = !isOpen;
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  function runSearch(value: string) {
    query = value;
    selectedIndex = 0;
    const trimmed = value.trim();
    results = trimmed
      ? (ensureIndex().search(trimmed).slice(0, MAX_RESULTS) as unknown as PaletteRecord[])
      : [];
  }

  function onInputKeydown(event: KeyboardEvent) {
    const count = Math.max(1, flat.length);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % count;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + count) % count;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = flat[selectedIndex];
      if (target) go(target.anchor);
    }
  }

  function go(anchor: string) {
    isOpen = false;
    window.location.hash = anchor;
  }

  /* ── match highlighting ────────────────────────────────────────────────
     Escape first, then mark, so the result is safe to hand to {@html}. */

  function escapeHtml(value: string): string {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? '',
    );
  }

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function searchTerms(value: string): string[] {
    return value
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 1)
      .map((term) => escapeRegExp(escapeHtml(term)));
  }

  function mark(text: string, terms: string[]): string {
    const escaped = escapeHtml(text);
    if (terms.length === 0) return escaped;
    return escaped.replace(new RegExp(`(${terms.join('|')})`, 'gi'), '<mark>$1</mark>');
  }

  function snippet(body: string, terms: string[]): string {
    if (!body) return '';

    const haystack = body.toLowerCase();
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 1);

    let at = -1;
    for (const word of words) {
      const found = haystack.indexOf(word);
      if (found !== -1 && (at === -1 || found < at)) at = found;
    }

    const radius = 90;
    if (at === -1) {
      const head = body.slice(0, radius * 2);
      return mark(head + (body.length > head.length ? '…' : ''), terms);
    }

    const start = Math.max(0, at - radius);
    const end = Math.min(body.length, at + radius);
    return mark(
      (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : ''),
      terms,
    );
  }
</script>

<dialog
  bind:this={dialogEl}
  class="palette"
  aria-labelledby="palette-title"
  onclose={() => (isOpen = false)}
  onpointerdown={(event) => (pointerDownOnBackdrop = event.target === dialogEl)}
  onclick={(event) => {
    // A click on ::backdrop targets the dialog element itself. The pointerdown
    // guard keeps a text selection that starts inside and ends outside from
    // being read as a dismissal.
    if (event.target === dialogEl && pointerDownOnBackdrop) isOpen = false;
  }}
>
  <h2 id="palette-title" class="sr-only">Search {siteConfig.name}</h2>

  <div class="palette-field">
    <Search size={15} aria-hidden="true" />
    <input
      bind:this={inputEl}
      value={query}
      oninput={(event) => runSearch(event.currentTarget.value)}
      onkeydown={onInputKeydown}
      type="text"
      placeholder="Search sections, endpoints, schemas…"
      aria-label="Search query"
      aria-controls="palette-results"
      autocomplete="off"
      spellcheck="false"
    />
    {#if query}
      <button
        type="button"
        class="palette-clear"
        onclick={() => {
          runSearch('');
          inputEl?.focus();
        }}
        aria-label="Clear search"
      >
        <X size={13} aria-hidden="true" />
      </button>
    {/if}
    <kbd class="palette-key">Esc</kbd>
  </div>

  <div id="palette-results" class="palette-results" role="listbox" aria-label="Search results">
    {#if flat.length > 0}
      {#each groups as group (group.docId)}
        <p class="palette-group">
          <span>{group.section}</span>
          <span class="palette-group-title">{group.docTitle}</span>
        </p>
        {#each group.items as item (item.id)}
          {@const position = flat.indexOf(item)}
          <button
            type="button"
            class="palette-item"
            class:is-selected={selectedIndex === position}
            role="option"
            aria-selected={selectedIndex === position}
            onclick={() => go(item.anchor)}
            onmousemove={() => (selectedIndex = position)}
          >
            <span class="palette-item-icon" aria-hidden="true">
              <FileText size={13} />
            </span>
            <span class="palette-item-text">
              <span class="palette-item-title">
                {@html mark(item.heading || item.docTitle, activeTerms)}
              </span>
              {#if item.body}
                <span class="palette-item-snippet">{@html snippet(item.body, activeTerms)}</span>
              {/if}
            </span>
          </button>
        {/each}
      {/each}
    {:else if query.trim()}
      <div class="palette-empty">
        <p class="palette-empty-title">No matches for “{query.trim()}”</p>
        <p>Try a shorter term, or a word used in a heading such as “schema” or “pipeline”.</p>
      </div>
    {:else}
      <div class="palette-empty">
        <p class="palette-empty-title">Search the documentation</p>
        <p>
          {docsIndex.length} documents indexed offline. Jump straight to a section, endpoint or
          schema.
        </p>
      </div>
    {/if}
  </div>

  <div class="palette-footer">
    <span><kbd class="palette-key">↑</kbd><kbd class="palette-key">↓</kbd> navigate</span>
    <span><kbd class="palette-key">↵</kbd> open</span>
    <span><kbd class="palette-key">Esc</kbd> close</span>
    <span class="palette-footer-note">Indexed at build time</span>
  </div>
</dialog>

<style>
  .palette {
    width: min(40rem, calc(100vw - 2rem));
    max-height: min(30rem, calc(100dvh - 4rem));
    margin-inline: auto;
    margin-top: max(10vh, 2rem);
    padding: 0;
    border: 1px solid var(--color-edge-strong);
    border-radius: var(--radius-panel);
    background-color: var(--color-base-100);
    color: var(--color-base-content);
    overflow: hidden;
    box-shadow: 0 24px 60px -20px color-mix(in oklab, var(--color-base-content) 45%, transparent);
  }

  /* Author styles beat the UA sheet regardless of specificity, so `display`
     must be scoped to [open] — otherwise the closed dialog renders in flow. */
  .palette[open] {
    display: flex;
    flex-direction: column;
  }

  .palette::backdrop {
    background-color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
    backdrop-filter: blur(2px);
  }

  .palette-field {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--color-edge);
    background-color: var(--color-base-200);
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }

  .palette-field input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--color-base-content);
    font-size: 0.9375rem;
    outline: none;
  }
  .palette-field input::placeholder {
    color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
  }

  .palette-clear {
    display: grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: var(--radius-chip);
    color: inherit;
    cursor: pointer;
  }
  .palette-clear:hover {
    background-color: var(--color-base-300);
  }

  .palette-key {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    padding: 0.05rem 0.3rem;
    background-color: var(--color-base-100);
  }

  .palette-results {
    flex: 1;
    overflow-y: auto;
    padding: 0.35rem;
  }

  .palette-group {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.55rem 0.5rem 0.25rem;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  }
  .palette-group-title {
    color: color-mix(in oklab, var(--color-base-content) 70%, transparent);
  }

  .palette-item {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    width: 100%;
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius-edge);
    text-align: start;
    cursor: pointer;
    color: inherit;
  }
  .palette-item.is-selected {
    background-color: var(--color-base-200);
    box-shadow: inset 2px 0 0 var(--color-primary);
  }

  .palette-item-icon {
    display: inline-flex;
    margin-top: 0.15rem;
    flex-shrink: 0;
    color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  }

  .palette-item-text {
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
    min-width: 0;
  }

  .palette-item-title {
    font-size: 0.875rem;
    font-weight: 560;
    line-height: 1.35;
  }

  .palette-item-snippet {
    font-size: var(--text-meta);
    line-height: 1.45;
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .palette-item :global(mark) {
    background-color: color-mix(in oklab, var(--color-primary) 26%, transparent);
    color: var(--color-base-content);
    border-radius: 2px;
    padding: 0 1px;
  }

  .palette-empty {
    padding: 1.75rem 1rem;
    text-align: center;
    color: color-mix(in oklab, var(--color-base-content) 58%, transparent);
    font-size: var(--text-meta);
  }
  .palette-empty-title {
    color: var(--color-base-content);
    font-weight: 600;
    font-size: 0.875rem;
    margin-bottom: 0.3rem;
  }

  .palette-footer {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.4rem 0.75rem;
    border-top: 1px solid var(--color-edge);
    background-color: var(--color-base-200);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }
  .palette-footer span {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .palette-footer-note {
    margin-inline-start: auto;
  }
</style>
