<script lang="ts">
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { Braces, Check, ChevronDown, ChevronRight, Copy, Search } from '@lucide/svelte';
  import { copyText } from '../clipboard';
  import { scrollAffordance } from '../actions/scroll-affordance';

  interface Props {
    data: unknown;
    title?: string;
    /** How many levels start expanded. */
    defaultExpandedDepth?: number;
  }

  let { data, title = 'JSON payload', defaultExpandedDepth = 2 }: Props = $props();

  type Kind = 'object' | 'array' | 'leaf';

  interface Row {
    path: string;
    parentPath: string | null;
    label: string;
    value: unknown;
    depth: number;
    kind: Kind;
    childCount: number;
    trailing: boolean;
  }

  /** Children beyond this are hidden behind an explicit "show all" row. */
  const CHILD_WINDOW = 100;

  let filter = $state('');
  let copiedPath = $state<string | null>(null);
  let activeIndex = $state(0);
  let treeEl = $state<HTMLElement | null>(null);

  /** Expansion is collapsed into a set of collapsed paths, so the default is open. */
  let collapsed = new SvelteSet<string>();
  let expandedAll = $state(false);
  let expandedLimits = new SvelteMap<string, boolean>();

  const root = $derived.by(() => {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return { raw: data };
      }
    }
    return data;
  });

  function kindOf(value: unknown): Kind {
    if (Array.isArray(value)) return 'array';
    if (value !== null && typeof value === 'object') return 'object';
    return 'leaf';
  }

  function childCountOf(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    if (value !== null && typeof value === 'object') return Object.keys(value as object).length;
    return 0;
  }

  function isExpanded(path: string, depth: number): boolean {
    if (collapsed.has(path)) return false;
    if (expandedAll) return true;
    return depth < defaultExpandedDepth;
  }

  /** Flattened view of the tree — the model the keyboard walks. */
  const rows = $derived.by(() => {
    const out: Row[] = [];

    const walk = (value: unknown, path: string, parentPath: string | null, label: string, depth: number) => {
      const kind = kindOf(value);
      const childCount = childCountOf(value);
      const children = kind === 'array' ? (value as unknown[]) : ((value ?? {}) as Record<string, unknown>);
      const showAll = expandedLimits.get(path) === true;
      const limit = showAll ? childCount : Math.min(childCount, CHILD_WINDOW);

      out.push({
        path,
        parentPath,
        label,
        value,
        depth,
        kind,
        childCount,
        trailing: false,
      });

      if (kind === 'leaf' || !isExpanded(path, depth)) return;

      const entries = Array.isArray(children)
        ? children.slice(0, limit).map((item, index) => [String(index), item] as const)
        : Object.entries(children).slice(0, limit);

      for (const [key, child] of entries) {
        walk(child, `${path}/${key}`, path, key, depth + 1);
      }

      if (childCount > limit) {
        out.push({
          path: `${path}/__more__`,
          parentPath: path,
          label: `Show ${childCount - limit} more…`,
          value: undefined,
          depth: depth + 1,
          kind: 'leaf',
          childCount: 0,
          trailing: true,
        });
      }
    };

    walk(root, '$', null, '$', 0);
    return out;
  });

  /** Rows kept by the key/value filter, with their ancestors. */
  const visibleRows = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;

    const keep = new SvelteSet<string>();
    for (const row of rows) {
      if (row.trailing) continue;
      const haystack = `${row.label} ${preview(row.value)}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
      keep.add(row.path);
      // Walk up so ancestors stay in place for context.
      let parent = row.parentPath;
      while (parent) {
        keep.add(parent);
        parent = rows.find((candidate) => candidate.path === parent)?.parentPath ?? null;
      }
    }
    return rows.filter((row) => keep.has(row.path) || row.trailing);
  });

  const clampActive = $derived(Math.min(activeIndex, Math.max(0, visibleRows.length - 1)));

  function preview(value: unknown): string {
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value as object);
      return keys.length ? `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }` : '{}';
    }
    return JSON.stringify(value) ?? String(value);
  }

  function typeName(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  function containerLabel(kind: Kind, childCount: number): string {
    return kind === 'array' ? `${childCount} items` : `${childCount} keys`;
  }

  function toggle(path: string, depth: number) {
    if (collapsed.has(path)) {
      if (!expandedAll && depth >= defaultExpandedDepth) expandedAll = true;
      collapsed.delete(path);
    } else {
      collapsed.add(path);
    }
  }

  function expandAll() {
    collapsed.clear();
    expandedAll = true;
  }

  function collapseAll() {
    expandedAll = false;
    collapsed.clear();
    for (const row of rows) {
      if (row.childCount > 0) collapsed.add(row.path);
    }
  }

  function focusRow(index: number) {
    const next = Math.max(0, Math.min(index, visibleRows.length - 1));
    activeIndex = next;
    const target = visibleRows[next];
    if (!target || !treeEl) return;
    treeEl.querySelector<HTMLElement>(`[data-path="${CSS.escape(target.path)}"]`)?.focus();
  }

  function onTreeKeydown(event: KeyboardEvent) {
    const row = visibleRows[clampActive];
    if (!row) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(clampActive + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(clampActive - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusRow(0);
        break;
      case 'End':
        event.preventDefault();
        focusRow(visibleRows.length - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (row.childCount > 0 && !isExpanded(row.path, row.depth)) toggle(row.path, row.depth);
        else if (row.childCount > 0) focusRow(clampActive + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (row.childCount > 0 && isExpanded(row.path, row.depth)) toggle(row.path, row.depth);
        else if (row.parentPath) {
          const parentIndex = visibleRows.findIndex((candidate) => candidate.path === row.parentPath);
          if (parentIndex !== -1) focusRow(parentIndex);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (row.trailing) activateTrailing(row);
        else if (row.childCount > 0) toggle(row.path, row.depth);
        break;
      case 'c':
        event.preventDefault();
        void copySubtree(row.path, row.value);
        break;
    }
  }

  function activateTrailing(row: Row) {
    if (row.parentPath) expandedLimits.set(row.parentPath, true);
  }

  async function copySubtree(path: string, value: unknown) {
    const ok = await copyText(JSON.stringify(value, null, 2) ?? String(value));
    if (!ok) return;
    copiedPath = path;
    setTimeout(() => (copiedPath = null), 1600);
  }

  const copiedAll = $derived(copiedPath === '$$all$$');

  async function copyAll() {
    const ok = await copyText(JSON.stringify(root, null, 2) ?? '');
    if (!ok) return;
    copiedPath = '$$all$$';
    setTimeout(() => (copiedPath = null), 1600);
  }

  const expandableCount = $derived(rows.filter((row) => row.childCount > 0).length);
  const anyExpanded = $derived(
    rows.some((row) => row.childCount > 0 && isExpanded(row.path, row.depth)),
  );
</script>

<section class="jt" aria-labelledby="jt-title">
  <div class="jt-bar">
    <span id="jt-title" class="jt-title">
      <Braces size={13} aria-hidden="true" />
      {title}
    </span>

    <span class="jt-actions">
      <span class="jt-filter">
        <Search size={12} aria-hidden="true" />
        <input
          type="search"
          bind:value={filter}
          placeholder="Filter keys…"
          aria-label="Filter keys"
          spellcheck="false"
        />
      </span>
      <button type="button" class="jt-btn" onclick={expandAll} disabled={expandedAll}>
        Expand all
      </button>
      <button type="button" class="jt-btn" onclick={collapseAll} disabled={!anyExpanded}>
        Collapse all
      </button>
      <button type="button" class="jt-btn jt-copy" onclick={copyAll}>
        {#if copiedAll}
          <Check size={12} aria-hidden="true" />
          Copied
        {:else}
          <Copy size={12} aria-hidden="true" />
          Copy JSON
        {/if}
      </button>
    </span>
  </div>

  <div
    class="jt-tree"
    role="tree"
    aria-label={`${title}, ${expandableCount} expandable nodes`}
    bind:this={treeEl}
    use:scrollAffordance
  >
    {#if visibleRows.length === 0}
      <p class="jt-empty">No key matches “{filter.trim()}”.</p>
    {:else}
      {#each visibleRows as row, index (row.path)}
        {@const expanded = row.childCount > 0 && isExpanded(row.path, row.depth)}
        <div
          class="jt-row"
          class:is-trailing={row.trailing}
          class:is-active={index === clampActive}
          role="treeitem"
          aria-level={row.depth + 1}
          aria-selected={index === clampActive}
          aria-expanded={row.trailing || row.childCount === 0 ? undefined : expanded}
          tabindex={index === clampActive ? 0 : -1}
          data-path={row.path}
          style="padding-inline-start: calc({row.depth} * 0.9rem + 0.4rem)"
          onclick={() => {
            if (row.trailing) activateTrailing(row);
            else if (row.childCount > 0) toggle(row.path, row.depth);
          }}
          onkeydown={(event) => {
            onTreeKeydown(event);
          }}
          onfocus={() => (activeIndex = index)}
        >
          <span class="jt-twisty" aria-hidden="true">
            {#if row.childCount > 0}
              {#if expanded}
                <ChevronDown size={12} />
              {:else}
                <ChevronRight size={12} />
              {/if}
            {/if}
          </span>

          {#if !row.trailing}
            <span class="jt-key" class:is-root={row.label === '$'}>{row.label}</span>
            <span class="jt-colon" aria-hidden="true">:</span>
            <span class="jt-value" data-kind={typeName(row.value)}>
              {#if row.childCount > 0}
                <span class="jt-count">{containerLabel(row.kind, row.childCount)}</span>
              {:else}
                <span class="jt-primitive">{preview(row.value)}</span>
              {/if}
            </span>
            <span class="jt-type">{typeName(row.value)}</span>

            {#if copiedPath === row.path}
              <span class="jt-copied" role="status">
                <Check size={11} aria-hidden="true" /> copied
              </span>
            {/if}
          {:else}
            <span class="jt-more">{row.label}</span>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <p class="jt-hint">
    <kbd>↑</kbd><kbd>↓</kbd> move · <kbd>→</kbd><kbd>←</kbd> expand / collapse · <kbd>c</kbd> copy
    subtree
  </p>
</section>

<style>
  .jt {
    margin-block: 1rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-panel);
    overflow: hidden;
    background-color: var(--color-base-100);
  }

  .jt-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem 0.4rem 0.7rem;
    border-bottom: 1px solid var(--color-edge);
    background-color: var(--color-base-200);
  }

  .jt-title {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  }

  .jt-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  .jt-filter {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    background-color: var(--color-base-100);
    color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  }
  .jt-filter input {
    width: 9rem;
    border: 0;
    background: transparent;
    color: var(--color-base-content);
    font-size: var(--text-micro);
    outline: none;
  }

  .jt-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.18rem 0.5rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    background-color: var(--color-base-100);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 70%, transparent);
    cursor: pointer;
    transition:
      border-color 120ms ease-out,
      color 120ms ease-out;
  }
  .jt-btn:hover:not(:disabled) {
    border-color: var(--color-edge-strong);
    color: var(--color-base-content);
  }
  .jt-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .jt-tree {
    max-height: 26rem;
    overflow: auto;
    padding-block: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.7;
  }

  .jt-row {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    padding-block: 0.05rem;
    padding-inline-end: 0.75rem;
    white-space: nowrap;
    cursor: default;
    border-inline-start: 2px solid transparent;
  }
  .jt-row:focus-visible {
    outline: none;
    background-color: var(--color-base-200);
    border-inline-start-color: var(--color-primary);
  }
  .jt-row.is-active {
    background-color: color-mix(in oklab, var(--color-base-200) 70%, transparent);
  }
  .jt-row.is-trailing {
    cursor: pointer;
    color: var(--color-primary);
  }

  .jt-twisty {
    display: inline-flex;
    width: 0.85rem;
    flex-shrink: 0;
    color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  }

  .jt-key {
    color: var(--color-base-content);
  }
  .jt-key.is-root {
    color: var(--color-primary);
    font-weight: 600;
  }

  .jt-colon {
    color: color-mix(in oklab, var(--color-base-content) 40%, transparent);
  }

  .jt-value {
    color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
  }

  .jt-count {
    margin-inline-start: 0.35rem;
    color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
  }

  /* Primitive colours are the only place value types are distinguished, and
     each one also carries a type badge, so colour is never the sole signal. */
  .jt-value[data-kind='string'] .jt-primitive {
    color: var(--color-success);
  }
  .jt-value[data-kind='number'] .jt-primitive {
    color: var(--color-info);
  }
  .jt-value[data-kind='boolean'] .jt-primitive {
    color: var(--color-accent);
  }
  .jt-value[data-kind='null'] .jt-primitive,
  .jt-value[data-kind='undefined'] .jt-primitive {
    color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
    font-style: italic;
  }

  .jt-type {
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 32%, transparent);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    padding: 0 0.25rem;
    margin-inline-start: 0.3rem;
  }

  .jt-copied {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: var(--text-micro);
    color: var(--color-success);
  }

  .jt-more {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .jt-empty {
    padding: 1rem;
    font-size: var(--text-meta);
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }

  .jt-hint {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.35rem 0.7rem;
    border-top: 1px solid var(--color-edge);
    background-color: var(--color-base-200);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  }
  .jt-hint kbd {
    font-family: var(--font-mono);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    padding: 0 0.25rem;
    background-color: var(--color-base-100);
  }
</style>
