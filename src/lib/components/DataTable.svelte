<script lang="ts">
  import type { Snippet } from 'svelte';
  import { scrollAffordance } from '../actions/scroll-affordance';

  // ── Types ────────────────────────────────────────────────────────────────────

  export type Alignment = 'start' | 'center' | 'end';
  export type SortDir = 'asc' | 'desc' | null;
  export type BadgeVariant = 'default' | 'info' | 'success' | 'warning' | 'error';
  export type Density = 'comfortable' | 'compact';

  /**
   * How long a column is kept as the container narrows: 1 for as long as
   * anything fits, 2 until 34rem, 3 until 28rem.
   */
  export type ColumnPriority = 1 | 2 | 3;

  export interface Column<T = Record<string, unknown>> {
    key: string;
    label: string;
    /** Column content alignment. Default: 'start', or 'end' when numeric. */
    align?: Alignment;
    /** Allow click-to-sort on this column. Default: false. */
    sortable?: boolean;
    /** Optional explicit column width (e.g. '80px', '20%'). If omitted, width is automatically calculated across columns. */
    width?: string;
    /** Optional cell render override — receives the raw cell value + full row. */
    cell?: (value: unknown, row: T) => string;
    /** Wrap the cell value in a badge chip. */
    badge?: (value: unknown, row: T) => BadgeVariant | false;
    /** Optional relative grow share when using fixed layout. */
    grow?: number;
    /** Drops the column on a narrow container. Ignored in a fixed layout. */
    priority?: ColumnPriority;
    /** Tabular figures, so a column of numbers lines up. */
    numeric?: boolean;
    /** Compares whole rows, for values a plain comparison gets wrong (versions). */
    sortFn?: (a: T, b: T) => number;
  }

  interface Props<T = Record<string, unknown>> {
    /** Column definitions. */
    columns: Column<T>[];
    /** Row data — any array of objects. */
    rows: T[];
    /**
     * Optional row key accessor. Defaults to row index.
     * Providing a stable key gives Svelte better diffing.
     */
    rowKey?: (row: T, index: number) => string | number;
    /** Caption shown at the bottom of the table (accessibility + context). */
    caption?: string;
    /** Override for the empty-state slot. */
    empty?: Snippet;
    /**
     * Column to sort by initially.
     * Must match a `column.key` that has `sortable: true`.
     */
    sortKey?: string;
    sortDir?: SortDir;
    /** Highlight rows on hover. Default: true. */
    hoverable?: boolean;
    /** Compact row height variant. Default: false. */
    compact?: boolean;
    /** Row height. `compact` is the shorthand for `density="compact"`. */
    density?: Density;
    /**
     * Column layout algorithm. Defaults to 'auto' for natural full-width space distribution.
     */
    layout?: 'auto' | 'fixed';
    /** Stretch the table to fill its container width. Default: true. */
    fullWidth?: boolean;
    /**
     * Stripe alternate rows. Default: false.
     * Note: `striped` and `hoverable` combine gracefully — hover always wins.
     */
    striped?: boolean;
    /**
     * Freeze the header row while the body scrolls.
     * Default: true. Needs `maxHeight` to have a scroll box to stick inside.
     */
    stickyHeader?: boolean;
    /** Pin the first column — the row's identifier — while the rest scrolls. */
    stickyFirst?: boolean;
    /** Gives the body a scroll box, which is what lets the header stick. */
    maxHeight?: string;
    /**
     * Below 28rem of container the row becomes a stacked card with each cell
     * labelled. Default: true.
     */
    stack?: boolean;
    /**
     * Allow cells to wrap text. Default: false (single-line, truncating).
     * Set true for tables with long prose values.
     */
    wrap?: boolean;
  }

  // ── Component state ──────────────────────────────────────────────────────────

  let {
    columns,
    rows,
    rowKey,
    caption,
    empty,
    sortKey = $bindable(undefined),
    sortDir = $bindable(null),
    hoverable = true,
    compact = false,
    density,
    layout,
    fullWidth = true,
    striped = false,
    stickyHeader = true,
    stickyFirst = false,
    maxHeight,
    stack = true,
    wrap = false,
  }: Props = $props();

  /** A value long enough that it could plausibly be the one being truncated. */
  const TITLE_THRESHOLD = 16;

  const resolvedDensity = $derived<Density>(density ?? (compact ? 'compact' : 'comfortable'));

  const isFixed = $derived(layout === 'fixed');

  /**
   * Computes column styles when explicit widths are authored or when fixed layout is requested.
   * In standard 'auto' mode without fixed col widths, colgroup is omitted so the browser's
   * table layout algorithm dynamically balances column widths across the full width of the container.
   */
  const columnStyles = $derived.by(() => {
    const hasExplicit = columns.some((col) => col.width != null || (col.grow != null && col.grow > 0));
    if (!hasExplicit && !isFixed) return null;

    if (isFixed) {
      const totalGrow = columns.reduce((sum, col) => sum + (col.grow ?? 1), 0);
      return columns.map((col) => col.width ?? `${(((col.grow ?? 1) / totalGrow) * 100).toFixed(4)}%`);
    }

    if (columns.some((col) => col.width != null)) {
      return columns.map((col) => col.width || undefined);
    }

    return null;
  });

  let announcement = $state('');

  function ariaSort(key: string) {
    if (sortKey !== key || !sortDir) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  function toggleSort(key: string) {
    if (sortKey !== key) {
      sortKey = key;
      sortDir = 'asc';
    } else if (sortDir === 'asc') {
      sortDir = 'desc';
    } else {
      sortKey = undefined;
      sortDir = null;
    }

    // `aria-sort` is silent on change, so the reader is told instead.
    const label = columns.find((col) => col.key === sortKey)?.label;
    announcement =
      sortKey && sortDir && label
        ? `Sorted by ${label}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`
        : 'Sort cleared';
  }

  // ── Derived: sorted rows ─────────────────────────────────────────────────────

  const sortedRows = $derived.by(() => {
    const key = sortKey;
    const direction = sortDir;
    if (!key || !direction) return rows;

    const column = columns.find((col) => col.key === key);
    const factor = direction === 'asc' ? 1 : -1;

    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const av = (a.row as Record<string, unknown>)[key];
        const bv = (b.row as Record<string, unknown>)[key];

        // A missing value is absent rather than extreme, so it keeps to the end
        // in both directions.
        if (av == null || bv == null) {
          if (av == null && bv == null) return a.index - b.index;
          return av == null ? 1 : -1;
        }

        const compared = column?.sortFn ? column.sortFn(a.row, b.row) : compareValues(av, bv);
        // Rows that compare equal keep the order they were authored in.
        return compared !== 0 ? compared * factor : a.index - b.index;
      })
      .map((entry) => entry.row);
  });

  function compareValues(av: unknown, bv: unknown): number {
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function cellValue(col: Column, row: Record<string, unknown>): string {
    const raw = row[col.key];
    return col.cell ? col.cell(raw, row) : raw == null ? '—' : String(raw);
  }

  function badgeVariant(col: Column, row: Record<string, unknown>): BadgeVariant | false {
    return col.badge ? col.badge(row[col.key], row) : false;
  }

  function alignOf(col: Column): Alignment {
    return col.align ?? (col.numeric ? 'end' : 'start');
  }

  /**
   * A truncated cell is the one place a value goes missing, so the full text
   * rides along as a title — but only where it could plausibly be clipped, as
   * a tooltip on every short cell is noise.
   */
  function cellTitle(text: string): string | undefined {
    if (wrap || text.length <= TITLE_THRESHOLD) return undefined;
    return text;
  }
</script>

<div
  class="dt-wrap"
  class:dt-full={fullWidth}
  class:dt-stackable={stack}
>
  <div
    class="dt-scroll"
    class:dt-bounded={maxHeight !== undefined}
    style:max-height={maxHeight}
    role="region"
    aria-label={caption ?? 'Data table'}
    use:scrollAffordance
  >
    <table
      class="dt not-prose"
      class:dt-fixed={isFixed}
      class:dt-compact={resolvedDensity === 'compact'}
      class:dt-hoverable={hoverable}
      class:dt-striped={striped}
      class:dt-wrap-cells={wrap}
      class:dt-sticky-first={stickyFirst}
    >
      {#if caption}
        <caption class="dt-caption">{caption}</caption>
      {/if}

      {#if columnStyles}
        <colgroup>
          {#each columns as col, index (col.key)}
            <col style:width={columnStyles[index]} />
          {/each}
        </colgroup>
      {/if}

      <thead class:dt-thead-sticky={stickyHeader}>
        <tr>
          {#each columns as col (col.key)}
            {@const align = alignOf(col)}
            <th
              scope="col"
              class="dt-th"
              class:dt-th-sortable={col.sortable}
              class:dt-th-sorted={sortKey === col.key}
              class:dt-align-center={align === 'center'}
              class:dt-align-end={align === 'end'}
              class:dt-numeric={col.numeric}
              data-priority={isFixed ? undefined : col.priority}
              style:min-width={isFixed ? undefined : col.width}
              aria-sort={col.sortable ? ariaSort(col.key) : undefined}
            >
              {#if col.sortable}
                <!-- Full-cell hit area: button fills the th via absolute sizing -->
                <button
                  type="button"
                  class="dt-sort-btn"
                  onclick={() => toggleSort(col.key)}
                >
                  <span class="dt-sort-label">{col.label}</span>
                  <span class="dt-sort-icon" aria-hidden="true">
                    {#if sortKey === col.key && sortDir === 'asc'}
                      <!-- Ascending arrow -->
                      <svg class="dt-sort-svg dt-sort-svg-active" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                        <path d="M5 2 L5 8 M2 5 L5 2 L8 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    {:else if sortKey === col.key && sortDir === 'desc'}
                      <!-- Descending arrow -->
                      <svg class="dt-sort-svg dt-sort-svg-active" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                        <path d="M5 8 L5 2 M2 5 L5 8 L8 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    {:else}
                      <!-- Idle double-arrow -->
                      <svg class="dt-sort-svg dt-sort-svg-idle" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                        <path d="M5 1 L5 4 M3 3 L5 1 L7 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M5 9 L5 6 M3 7 L5 9 L7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    {/if}
                  </span>
                </button>
              {:else}
                <span class="dt-th-label">{col.label}</span>
              {/if}
            </th>
          {/each}
        </tr>
      </thead>

      <tbody>
        {#if sortedRows.length === 0}
          <tr>
            <td class="dt-empty-cell" colspan={columns.length}>
              {#if empty}
                {@render empty()}
              {:else}
                <span class="dt-empty-inner">
                  <!-- Empty inbox icon -->
                  <svg class="dt-empty-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M3 9l1.5-6h15L21 9M3 9h18M3 9v9a2 2 0 002 2h14a2 2 0 002-2V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M8 13h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                  <span class="dt-empty-text">No data to display</span>
                </span>
              {/if}
            </td>
          </tr>
        {:else}
          {#each sortedRows as row, i (rowKey ? rowKey(row as Record<string, unknown>, i) : i)}
            <tr class="dt-row">
              {#each columns as col (col.key)}
                {@const variant = badgeVariant(col, row as Record<string, unknown>)}
                {@const text = cellValue(col, row as Record<string, unknown>)}
                {@const align = alignOf(col)}
                <td
                  class="dt-td"
                  class:dt-align-center={align === 'center'}
                  class:dt-align-end={align === 'end'}
                  class:dt-numeric={col.numeric}
                  data-priority={isFixed ? undefined : col.priority}
                >
                  <!-- Carries the column name once the header row is out of
                       reach; hidden while a header cell still says it. -->
                  <span class="dt-cell-label">{col.label}</span>
                  <span class="dt-cell" title={cellTitle(text)}>
                    {#if variant !== false}
                      <span class="dt-badge" data-variant={variant}>{text}</span>
                    {:else}
                      {text}
                    {/if}
                  </span>
                </td>
              {/each}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <p class="sr-only" role="status">{announcement}</p>
</div>

<style>
  /* ── Container ───────────────────────────────────────────────────────────── */
  .dt-wrap {
    margin-block: 1.25rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-panel, 6px);
    overflow: hidden;
    background-color: var(--color-base-100);
    box-shadow: 0 1px 3px color-mix(in oklab, var(--color-base-content) 5%, transparent);
    width: 100%;
    container-type: inline-size;
    container-name: dt;
  }

  .dt-full {
    width: 100%;
  }

  /* Horizontal scroll without OS-level scrollbar chrome on non-touch devices. */
  .dt-scroll {
    overflow-x: auto;
    /* A sideways swipe inside the table must not carry on into the page. */
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--color-edge-strong) transparent;
  }
  .dt-scroll:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
  }

  /* An authored height is what turns the scroll region into a scroll box, and
     so what lets the header row stick. */
  .dt-bounded {
    overscroll-behavior-y: contain;
  }

  /* ── Table ───────────────────────────────────────────────────────────────── */
  .dt {
    display: table;
    width: 100%;
    min-width: 100%;
    border-collapse: collapse;
    table-layout: auto;
    font-size: var(--text-body);
    color: var(--color-base-content);
    white-space: nowrap;
    margin: 0;
  }

  .dt-fixed {
    table-layout: fixed;
  }

  .dt-fixed:not(.dt-wrap-cells) .dt-td {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dt-fixed .dt-th {
    overflow: hidden;
  }

  .dt-fixed .dt-th-label,
  .dt-fixed .dt-sort-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dt-wrap-cells {
    white-space: normal;
  }

  /* Figures line up in a column instead of drifting with the glyph widths. */
  .dt-numeric {
    font-variant-numeric: tabular-nums;
  }

  .dt-align-center {
    text-align: center;
  }
  .dt-align-end {
    text-align: end;
  }

  /* ── Caption ─────────────────────────────────────────────────────────────── */
  .dt-caption {
    caption-side: bottom;
    padding: 0.55rem 1rem;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
    text-align: start;
    border-top: 1px solid var(--color-edge);
  }

  /* ── Header ──────────────────────────────────────────────────────────────── */
  thead {
    border-bottom: 2px solid var(--color-edge-strong);
    background-color: var(--color-base-200);
  }

  /* Sticky header: clips to the scroll container by using a new stacking
     context. The 2-sided border trick (bottom only) avoids border-collapse
     gaps when the header lifts away from the body. */
  .dt-thead-sticky th {
    position: sticky;
    top: 0;
    z-index: 1;
    background-color: var(--color-base-200);
    /* Re-draw the bottom separator as a box-shadow so it sticks with the cell
       instead of collapsing away when the row scrolls. */
    box-shadow: 0 2px 0 var(--color-edge-strong);
  }

  .dt-th {
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    white-space: nowrap;
    text-align: start;
    /* The sort button fills this cell, so no extra padding here. */
    position: relative;
  }

  .dt-th-label {
    display: block;
    padding: 0.55rem 0.85rem;
  }

  .dt-align-center .dt-th-label {
    text-align: center;
  }

  .dt-align-end .dt-th-label {
    text-align: end;
  }

  .dt-th-sorted {
    color: var(--color-base-content);
  }

  /* Sort button: fills the entire <th> for a large, keyboard-friendly target.
     Inner layout: cleanly aligned with column orientation without disconnected gaps. */
  .dt-sort-btn {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.35rem;
    width: 100%;
    padding: 0.55rem 0.85rem;
    font: inherit;
    color: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
    border: 0;
    background: none;
    transition:
      color 120ms ease-out,
      background-color 120ms ease-out;
  }

  .dt-align-center .dt-sort-btn {
    justify-content: center;
  }

  .dt-align-end .dt-sort-btn {
    justify-content: flex-end;
  }

  .dt-sort-btn:active {
    scale: 0.96;
    transition: scale 60ms ease-out;
  }

  .dt-th-sortable:hover .dt-sort-btn {
    color: var(--color-base-content);
    background-color: color-mix(in oklab, var(--color-base-content) 5%, transparent);
  }

  .dt-th-sorted .dt-sort-btn {
    color: var(--color-base-content);
  }

  /* Focus ring on the button, not the th. */
  .dt-sort-btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
    border-radius: var(--radius-edge);
  }

  .dt-sort-label {
    flex: 0 1 auto;
    white-space: nowrap;
  }

  /* Sort icon: fixed square so label text does not shift when icon swaps. */
  .dt-sort-icon {
    display: grid;
    place-items: center;
    width: 1em;
    height: 1em;
    flex-shrink: 0;
  }

  .dt-sort-svg {
    width: 10px;
    height: 10px;
    transition:
      opacity 120ms cubic-bezier(0.2, 0, 0, 1),
      scale 120ms cubic-bezier(0.2, 0, 0, 1);
  }

  .dt-sort-svg-idle {
    opacity: 0.38;
    scale: 0.85;
  }

  .dt-sort-svg-active {
    opacity: 1;
    scale: 1;
    color: var(--color-primary);
  }

  /* ── Body rows ───────────────────────────────────────────────────────────── */
  /* Row tint lives in a variable so the pinned column can paint the same one —
     a sticky cell with its own background would tear the stripe in half. The
     default is the panel surface rather than `transparent`, because a pinned
     cell has to be opaque to hide the columns sliding under it. */
  .dt-row {
    --dt-row-bg: var(--color-base-100);
  }

  .dt-td {
    padding: 0.6rem 0.85rem;
    font-size: var(--text-body);
    border-top: 1px solid var(--color-edge);
    vertical-align: middle;
    background-color: var(--dt-row-bg);
  }

  /* The column name is only needed once the header row stops naming it. */
  .dt-cell-label {
    display: none;
  }

  .dt-compact .dt-th-label,
  .dt-compact .dt-sort-btn {
    padding: 0.4rem 0.75rem;
  }

  .dt-compact .dt-td {
    padding: 0.38rem 0.75rem;
    font-size: var(--text-meta);
  }

  /* Row hover — pointer feedback only; specify exact animated properties. */
  .dt-hoverable tbody .dt-row {
    transition: background-color 100ms ease-out;
  }

  .dt-hoverable tbody .dt-row:hover {
    --dt-row-bg: color-mix(in oklab, var(--color-base-content) 4%, var(--color-base-100));
  }

  /* Stripe: alternating light wash, reinforces row identity on wide tables. */
  .dt-striped tbody .dt-row:nth-child(even) {
    --dt-row-bg: color-mix(in oklab, var(--color-base-content) 3%, var(--color-base-100));
  }

  /* When both striped and hoverable, hover wins on all rows. */
  .dt-striped.dt-hoverable tbody .dt-row:hover {
    --dt-row-bg: color-mix(in oklab, var(--color-base-content) 6%, var(--color-base-100));
  }

  /* ── Pinned first column ─────────────────────────────────────────────────── */
  .dt-sticky-first .dt-th:first-child,
  .dt-sticky-first .dt-td:first-child {
    position: sticky;
    inset-inline-start: 0;
    z-index: 2;
    /* The edge that separates the pinned column from the ones sliding under it. */
    box-shadow: inset -1px 0 0 var(--color-edge);
  }

  /* Opaque, or the columns passing underneath would show through. */
  .dt-sticky-first .dt-td:first-child {
    background-color: var(--dt-row-bg);
  }

  .dt-sticky-first .dt-th:first-child {
    z-index: 3;
    background-color: var(--color-base-200);
  }

  /* ── Empty state ─────────────────────────────────────────────────────────── */
  .dt-empty-cell {
    padding: 3rem 1rem;
    text-align: center;
  }

  .dt-empty-inner {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }

  .dt-empty-icon {
    width: 2rem;
    height: 2rem;
    color: color-mix(in oklab, var(--color-base-content) 28%, transparent);
    flex-shrink: 0;
  }

  .dt-empty-text {
    font-size: var(--text-meta);
    color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
    font-family: var(--font-mono);
    letter-spacing: 0.03em;
  }

  /* ── Badge chips ─────────────────────────────────────────────────────────── */
  .dt-badge {
    display: inline-flex;
    align-items: center;
    /* Concentric radius: badge sits inside a td, so inner radius = chip radius.
       Outer container radius is --radius-panel (6px). Badge has no nested
       rounded children, so chip radius (3px) is correct here. */
    padding: 0.1em 0.45em;
    border-radius: var(--radius-chip);
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid;

    /* default */
    background-color: color-mix(in oklab, var(--color-base-content) 8%, transparent);
    border-color: var(--color-edge);
    color: var(--color-base-content);
  }

  .dt-badge[data-variant='info'] {
    background-color: color-mix(in oklab, var(--color-info) 12%, transparent);
    border-color: color-mix(in oklab, var(--color-info) 30%, transparent);
    color: var(--color-info);
  }

  .dt-badge[data-variant='success'] {
    background-color: color-mix(in oklab, var(--color-success) 12%, transparent);
    border-color: color-mix(in oklab, var(--color-success) 30%, transparent);
    color: var(--color-success);
  }

  .dt-badge[data-variant='warning'] {
    background-color: color-mix(in oklab, var(--color-warning) 15%, transparent);
    border-color: color-mix(in oklab, var(--color-warning) 35%, transparent);
    color: color-mix(in oklab, var(--color-warning) 80%, var(--color-base-content));
  }

  .dt-badge[data-variant='error'] {
    background-color: color-mix(in oklab, var(--color-error) 12%, transparent);
    border-color: color-mix(in oklab, var(--color-error) 30%, transparent);
    color: var(--color-error);
  }

  /* ── Narrow container ─────────────────────────────────────────────────────
     A five-column grid cannot be read at 400px, so the row becomes a card with
     every cell named. The query asks the table's own box, so it is the width
     the article was given — not the viewport — that decides.
     ───────────────────────────────────────────────────────────────────────── */
  @container dt (max-width: 34rem) {
    .dt-th[data-priority='2'],
    .dt-td[data-priority='2'] {
      display: none;
    }
  }

  @container dt (max-width: 28rem) {
    .dt-th[data-priority='3'],
    .dt-td[data-priority='3'] {
      display: none;
    }
  }

  @container dt (max-width: 38rem) {
    /* Nothing scrolls here any more, so neither the fade nor the pinned
       column has anything left to say. */
    .dt-stackable .dt-scroll {
      overflow: visible;
      -webkit-mask-image: none;
      mask-image: none;
    }

    .dt-stackable .dt {
      display: flex;
      flex-direction: column;
      white-space: normal;
    }

    .dt-stackable colgroup {
      display: none;
    }

    /* The caption belongs under the body, and only an ordered box can say so
       once the table is no longer a table. */
    .dt-stackable .dt-caption {
      order: 1;
    }

    .dt-stackable .dt thead {
      background: none;
      border-bottom: 0;
    }

    .dt-stackable .dt thead tr {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      padding-block: 0.5rem;
      padding-inline: 0.5rem;
    }

    /* The header row survives as the sort bar: dropping it would leave the
       reader no way to sort at the width where the labels moved into the
       cards. A non-sortable column is named per cell instead. */
    .dt-stackable .dt-th:not(.dt-th-sortable) {
      display: none;
    }

    .dt-stackable .dt-th {
      position: static;
      display: inline-flex;
    }

    .dt-stackable .dt-sort-btn {
      min-height: 2rem;
      padding-inline: 0.65rem;
      border: 1px solid var(--color-edge);
      border-radius: var(--radius-chip);
      background-color: var(--color-base-200);
      font-size: var(--text-micro);
    }

    .dt-stackable .dt-sticky-first .dt-th:first-child,
    .dt-stackable .dt-sticky-first .dt-td:first-child {
      position: static;
      box-shadow: none;
    }

    .dt-stackable .dt tbody {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      padding: 0.5rem;
    }

    .dt-stackable .dt tr.dt-row {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--color-edge);
      border-radius: var(--radius-panel, 6px);
      overflow: hidden;
      background-color: var(--color-base-100);
      box-shadow: 0 1px 2px color-mix(in oklab, var(--color-base-content) 4%, transparent);
    }

    .dt-stackable .dt td.dt-td {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      /* The column's own alignment belonged to the grid it is no longer in. */
      text-align: end;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    .dt-stackable .dt td.dt-td:first-child {
      border-top: 0;
    }

    .dt-stackable .dt td.dt-td + td.dt-td {
      border-top: 1px solid color-mix(in oklab, var(--color-edge) 60%, transparent);
    }

    .dt-stackable .dt-cell-label {
      display: block;
      flex-shrink: 0;
      font-family: var(--font-mono);
      font-size: var(--text-micro);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
      text-align: start;
    }

    .dt-stackable .dt-cell {
      min-width: 0;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    .dt-stackable .dt-empty-cell {
      border-top: 0;
    }
  }

  /* ── Print ────────────────────────────────────────────────────────────────
     The document is the artifact: a truncated cell or a fade would be a
     silent omission on paper. */
  @media print {
    .dt-scroll {
      max-height: none !important;
      overflow: visible !important;
    }
    .dt-fixed:not(.dt-wrap-cells) .dt-td,
    .dt-fixed .dt-th,
    .dt-fixed .dt-th-label,
    .dt-fixed .dt-sort-label {
      overflow: visible;
      text-overflow: clip;
    }
    .dt {
      white-space: normal;
    }
  }
</style>
