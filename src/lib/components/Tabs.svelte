<script lang="ts">
  interface TabItem {
    id: string;
    label: string;
    /** Drives the language chip and copy button added by the code decorator. */
    language?: string;
    snippet?: string;
  }

  interface Props {
    items: TabItem[];
    activeId?: string;
  }

  let { items, activeId }: Props = $props();

  let overrideTab = $state<string | null>(null);
  let tablistEl = $state<HTMLElement | null>(null);

  const selectedId = $derived(overrideTab ?? activeId ?? items[0]?.id);
  const uid = `tabs-${Math.random().toString(36).slice(2, 8)}`;

  function select(id: string, focus = false) {
    overrideTab = id;
    if (!focus || !tablistEl) return;
    tablistEl.querySelector<HTMLButtonElement>(`#${CSS.escape(`${uid}-tab-${id}`)}`)?.focus();
  }

  function onTablistKeydown(event: KeyboardEvent) {
    const index = items.findIndex((item) => item.id === selectedId);
    if (index === -1) return;

    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;

    event.preventDefault();
    select(items[next].id, true);
  }
</script>

<div class="tabs-shell">
  <div
    class="tabs-bar"
    role="tablist"
    bind:this={tablistEl}
    aria-label="Code examples"
  >
    {#each items as tab (tab.id)}
      {@const isSelected = selectedId === tab.id}
      <button
        type="button"
        role="tab"
        id="{uid}-tab-{tab.id}"
        aria-selected={isSelected}
        aria-controls="{uid}-panel-{tab.id}"
        tabindex={isSelected ? 0 : -1}
        class="tab"
        class:is-selected={isSelected}
        onclick={() => select(tab.id)}
        onkeydown={onTablistKeydown}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#each items as tab (tab.id)}
    {@const isSelected = selectedId === tab.id}
    <div
      role="tabpanel"
      id="{uid}-panel-{tab.id}"
      aria-labelledby="{uid}-tab-{tab.id}"
      tabindex="0"
      class="tab-panel"
      hidden={!isSelected || undefined}
    >
      {#if tab.snippet}
        <!-- The code decorator adds the language chip and copy button. -->
        <pre data-code-block={tab.language ?? ''} data-language={tab.language ?? 'text'}><code
            >{tab.snippet}</code
          ></pre>
      {/if}
    </div>
  {/each}
</div>

<style>
  .tabs-shell {
    margin-block: 1rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-panel);
    overflow: hidden;
    background-color: var(--color-base-100);
  }

  .tabs-bar {
    display: flex;
    gap: 0.15rem;
    padding: 0.3rem 0.4rem 0;
    border-bottom: 1px solid var(--color-edge);
    background-color: var(--color-base-200);
    overflow-x: auto;
    scrollbar-width: thin;
    /* Fades the strip at both ends so overflow reads as "there is more". */
    mask-image: linear-gradient(
      to right,
      transparent 0,
      black 0.5rem,
      black calc(100% - 0.5rem),
      transparent 100%
    );
  }

  .tab {
    position: relative;
    flex-shrink: 0;
    padding: 0.35rem 0.7rem 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--text-meta);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    white-space: nowrap;
    cursor: pointer;
    transition: color 120ms ease-out;
  }

  .tab:hover {
    color: var(--color-base-content);
  }

  /* Selection is marked by an underline rule plus weight, not colour alone. */
  .tab::after {
    content: '';
    position: absolute;
    inset-inline: 0.35rem;
    bottom: 0;
    height: 2px;
    border-radius: 1px;
    background-color: transparent;
  }

  .tab.is-selected {
    color: var(--color-base-content);
    font-weight: 600;
  }
  .tab.is-selected::after {
    background-color: var(--color-primary);
  }

  .tab-panel {
    background-color: var(--color-base-100);
  }
  .tab-panel:focus-visible {
    outline-offset: -2px;
  }

  .tab-panel pre {
    margin: 0;
    padding: 0.9rem 1.1rem;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.65;
    color: var(--color-base-content);
    background-color: var(--color-base-200);
  }

  /* Inside the decorator frame the panel supplies its own surface. */
  .tab-panel :global(.code-block) {
    margin: 0;
    border: 0;
    border-radius: 0;
  }
</style>
