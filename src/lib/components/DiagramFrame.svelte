<script lang="ts">
  /**
   * Shared chrome for every diagram on the page.
   *
   * The bar, the controls, the export menu and the fullscreen dialog were
   * duplicated between the canvas and the Mermaid renderer, which is how the
   * two drifted apart (only one of them had fullscreen). Both now describe
   * their body and their actions; the frame owns everything around them.
   */
  import type { Snippet } from 'svelte';
  import { ChevronDown, Download, Maximize2, Minimize2, X } from '@lucide/svelte';

  export interface FrameExportItem {
    id: string;
    label: string;
    /** May return a line of status copy, which is announced politely. */
    run: () => void | string | Promise<void | string>;
  }

  interface Props {
    title: string;
    children: Snippet;
    /** Extra inline controls, before the export menu. */
    actions?: Snippet;
    /** Extra controls inside the fullscreen dialog. */
    fullscreenActions?: Snippet;
    /** Rendered under the body — legends and hints live here. */
    footer?: Snippet;
    /** Fullscreen body. Without it no fullscreen control is offered. */
    fullscreen?: Snippet;
    exportItems?: FrameExportItem[];
    open?: boolean;
  }

  let {
    title,
    children,
    actions,
    fullscreenActions,
    footer,
    fullscreen,
    exportItems = [],
    open = $bindable(false),
  }: Props = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuOpen = $state(false);
  let busy = $state(false);
  let status = $state('');
  /** Whether the current press began on the backdrop rather than inside. */
  let pointerDownOnBackdrop = false;

  $effect(() => {
    const dialog = dialogEl;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  // An open menu closes on a true outside press, and on Escape with focus
  // handed back to the control that opened it.
  $effect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (menuEl?.contains(event.target as Node)) return;
      if (triggerEl?.contains(event.target as Node)) return;
      closeMenu(false);
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      moveFocus(event);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeydown);
    // The menu is anchored to a fixed control, so a scroll would leave it
    // pointing at nothing. Closing it is the honest outcome, and it costs
    // nothing: the control is exactly where the reader left it.
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  });

  /**
   * The export menu is a popover because it has to escape the content column's
   * stacking context: a popover in the flow cannot be painted above the sticky
   * site header, whatever its z-index. Being in the top layer means positioning
   * it against the control it belongs to, which is all this does.
   */
  $effect(() => {
    const menu = menuEl;
    if (!menu) return;

    if (!menu.matches(':popover-open')) menu.showPopover();
    repositionMenu();

    return () => {
      if (menu.matches(':popover-open')) menu.hidePopover();
    };
  });

  function repositionMenu(): void {
    const menu = menuEl;
    const trigger = triggerEl;
    if (!menu || !trigger || !menu.matches(':popover-open')) return;

    const anchor = trigger.getBoundingClientRect();
    menu.style.top = `${Math.round(anchor.bottom + 4)}px`;
    menu.style.left = `${Math.round(anchor.right - menu.offsetWidth)}px`;
  }

  function closeMenu(returnFocus: boolean): void {
    menuOpen = false;
    if (returnFocus) triggerEl?.focus();
  }

  function onScroll(): void {
    if (menuOpen) closeMenu(false);
  }

  /** Arrow keys walk the open disclosure; Tab keeps working as it always does. */
  function moveFocus(event: KeyboardEvent): void {
    const move: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    const step = move[event.key];
    if (step === undefined) return;

    const items = [...(menuEl?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (items.length === 0) return;

    event.preventDefault();
    const current = items.findIndex((item) => item === document.activeElement);
    const next = current === -1 ? 0 : (current + step + items.length) % items.length;
    items[next].focus();
  }

  async function runItem(item: FrameExportItem): Promise<void> {
    if (busy) return;
    busy = true;
    status = '';

    try {
      status = (await item.run()) ?? '';
    } catch (cause) {
      status = cause instanceof Error ? cause.message : 'The export failed.';
    } finally {
      busy = false;
      closeMenu(true);
    }
  }
</script>

<div class="frame">
  <div class="frame-bar">
    <span class="frame-title">{title}</span>

    {#if status}
      <span class="frame-status" role="status">{status}</span>
    {/if}

    <span class="frame-controls no-print">
      {@render actions?.()}

      {#if exportItems.length > 0}
        <span class="frame-menu-wrap">
          <button
            type="button"
            class="frame-btn is-icon"
            bind:this={triggerEl}
            aria-expanded={menuOpen}
            aria-label="Export diagram"
            title="Export diagram"
            disabled={busy}
            onclick={() => (menuOpen ? closeMenu(true) : (menuOpen = true))}
          >
            <Download size={13} aria-hidden="true" />
            <ChevronDown size={10} aria-hidden="true" />
          </button>

          {#if menuOpen}
            <!-- A disclosure, not a menu: the buttons below keep their own
                 focus behaviour and the arrow keys only add convenience. -->
            <div class="frame-menu" popover="manual" bind:this={menuEl}>
              {#each exportItems as item (item.id)}
                <button type="button" class="frame-menu-item" onclick={() => runItem(item)}>
                  {item.label}
                </button>
              {/each}
            </div>
          {/if}
        </span>
      {/if}

      {#if fullscreen}
        <button
          type="button"
          class="frame-btn is-icon"
          onclick={() => (open = true)}
          aria-label="Open fullscreen"
          title="Open fullscreen"
        >
          <Maximize2 size={13} aria-hidden="true" />
        </button>
      {/if}
    </span>
  </div>

  <div class="frame-body">
    {@render children()}
  </div>

  {#if footer}
    <div class="frame-foot">
      {@render footer()}
    </div>
  {/if}
</div>

<dialog
  bind:this={dialogEl}
  class="frame-modal"
  aria-label="{title} — fullscreen"
  onclose={() => (open = false)}
  onpointerdown={(event) => (pointerDownOnBackdrop = event.target === dialogEl)}
  onclick={(event) => {
    // Matches the search palette: a press on the backdrop dismisses.
    if (event.target === dialogEl && pointerDownOnBackdrop) open = false;
  }}
>
  <div class="frame-bar">
    <span class="frame-title">{title}</span>
    <span class="frame-controls no-print">
      {@render fullscreenActions?.()}
      <button
        type="button"
        class="frame-btn is-icon"
        onclick={() => (open = false)}
        aria-label="Close fullscreen"
        title="Close fullscreen"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </span>
  </div>

  <div class="frame-modal-body">
    {@render fullscreen?.()}
  </div>

  <p class="frame-hint">
    <Minimize2 size={11} aria-hidden="true" /> Press Escape or click outside to close.
  </p>
</dialog>

<style>
  .frame {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .frame-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem 0.35rem 0.75rem;
    border-bottom: 1px solid var(--color-edge);
    background-color: var(--color-base-200);
  }

  .frame-title {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  }

  .frame-status {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }

  .frame-controls {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .frame-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
    padding: 0.2rem 0.35rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    background-color: var(--color-base-100);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 68%, transparent);
    cursor: pointer;
    transition:
      border-color 120ms ease-out,
      color 120ms ease-out;
  }
  .frame-btn.is-icon {
    border-color: transparent;
    padding: 0.25rem;
    background-color: transparent;
  }
  .frame-btn:hover:not(:disabled) {
    border-color: var(--color-edge-strong);
    color: var(--color-base-content);
  }
  .frame-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .frame-menu-wrap {
    position: relative;
  }

  .frame-menu {
    /* In the top layer, positioned from the trigger's own box. */
    position: fixed;
    inset: auto;
    margin: 0;
    display: flex;
    flex-direction: column;
    min-width: 11rem;
    padding: 0.2rem;
    border: 1px solid var(--color-edge-strong);
    border-radius: var(--radius-edge);
    background-color: var(--color-base-100);
    box-shadow: 0 6px 18px color-mix(in oklab, var(--color-base-content) 14%, transparent);
  }

  .frame-menu-item {
    padding: 0.3rem 0.45rem;
    border-radius: var(--radius-chip);
    text-align: start;
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
    cursor: pointer;
  }
  .frame-menu-item:hover,
  .frame-menu-item:focus-visible {
    background-color: var(--color-base-200);
    color: var(--color-base-content);
  }

  .frame-body {
    min-height: 0;
  }

  .frame-foot {
    border-top: 1px solid var(--color-edge);
    background-color: var(--color-base-200);
  }

  .frame-hint {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.75rem;
    border-top: 1px solid var(--color-edge);
    background-color: var(--color-base-200);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  }

  /* ── fullscreen ── */
  /* A larger view, not a takeover: 70% of the viewport leaves the backdrop
     reachable, which is what makes "click outside to close" mean anything —
     at 100% there is no outside left to press. */
  .frame-modal {
    /* 70% of the window, floored so a narrow phone still gets a usable box and
       capped so a gutter of backdrop always remains. */
    width: clamp(22rem, 70%, calc(100% - 2rem));
    height: clamp(18rem, 70%, calc(100% - 2rem));
    max-width: none;
    max-height: none;
    margin: auto;
    padding: 0;
    border: 1px solid var(--color-edge-strong);
    border-radius: var(--radius-panel);
    background-color: var(--color-base-100);
    color: var(--color-base-content);
    overflow: hidden;
    flex-direction: column;
  }
  .frame-modal[open] {
    display: flex;
  }
  .frame-modal::backdrop {
    background-color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
    backdrop-filter: blur(2px);
  }

  .frame-modal-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
