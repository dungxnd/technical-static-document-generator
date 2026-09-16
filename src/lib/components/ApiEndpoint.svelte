<script lang="ts">
  import { highlightJson, isJsonLike } from '../highlight-json';

  type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  interface Props {
    method: Method;
    path: string;
    description?: string;
    requestBody?: string;
    curlExample?: string;
    responseExample?: string;
  }

  let {
    method,
    path,
    description = '',
    requestBody = '',
    curlExample = '',
    responseExample = '',
  }: Props = $props();

  type PanelId = 'curl' | 'request' | 'response';

  interface Panel {
    id: PanelId;
    label: string;
    language: string;
    body: string;
  }

  const uid = `ep-${Math.random().toString(36).slice(2, 8)}`;
  let tablistEl = $state<HTMLElement | null>(null);
  let active = $state<PanelId>('curl');

  const computedCurl = $derived(
    curlExample ||
      `curl -X ${method} "https://api.local${path}" \\\n  -H "Content-Type: application/json"${
        requestBody ? ` \\\n  -d '${requestBody.replace(/\n\s*/g, ' ')}'` : ''
      }`,
  );

  const panels = $derived.by((): Panel[] => {
    const list: Panel[] = [
      { id: 'curl', label: 'cURL', language: 'bash', body: computedCurl },
    ];
    if (requestBody) {
      list.push({ id: 'request', label: 'Request', language: 'json', body: requestBody });
    }
    if (responseExample) {
      list.push({ id: 'response', label: 'Response', language: 'json', body: responseExample });
    }
    return list;
  });

  const current = $derived(panels.find((panel) => panel.id === active) ?? panels[0]);

  /** Renders JSON panels tokenized, everything else as plain text. */
  const bodyHtml = $derived(
    current?.language === 'json' && isJsonLike(current.body)
      ? highlightJson(current.body)
      : null,
  );

  /**
   * Method is carried by colour AND by the shape of the badge (dot + weight),
   * never by colour alone.
   */
  const methodTone: Record<Method, string> = {
    GET: 'var(--color-success)',
    POST: 'var(--color-info)',
    PUT: 'var(--color-warning)',
    PATCH: 'var(--color-accent)',
    DELETE: 'var(--color-error)',
  };

  function select(id: PanelId, focus = false) {
    active = id;
    if (!focus || !tablistEl) return;
    tablistEl.querySelector<HTMLButtonElement>(`#${CSS.escape(`${uid}-tab-${id}`)}`)?.focus();
  }

  function onTablistKeydown(event: KeyboardEvent) {
    const index = panels.findIndex((panel) => panel.id === active);
    if (index === -1) return;

    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % panels.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + panels.length) % panels.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = panels.length - 1;
    else return;

    event.preventDefault();
    select(panels[next].id, true);
  }
</script>

<section class="ep" style="--ep-tone: {methodTone[method] ?? 'var(--color-neutral)'}">
  <header class="ep-head">
    <span class="ep-method">{method}</span>
    <span class="ep-path">{path}</span>
    {#if description}
      <span class="ep-desc">{description}</span>
    {/if}
  </header>

  <div class="ep-bar">
    <div class="ep-tabs" role="tablist" bind:this={tablistEl} aria-label={`${method} ${path} examples`}>
      {#each panels as panel (panel.id)}
        {@const isSelected = active === panel.id}
        <button
          type="button"
          role="tab"
          id="{uid}-tab-{panel.id}"
          aria-selected={isSelected}
          aria-controls="{uid}-panel-{panel.id}"
          tabindex={isSelected ? 0 : -1}
          class="ep-tab"
          class:is-selected={isSelected}
          onclick={() => select(panel.id)}
          onkeydown={onTablistKeydown}
        >
          {panel.label}
        </button>
      {/each}
    </div>
  </div>

  {#each panels as panel (panel.id)}
    {#if active === panel.id}
      <div
        role="tabpanel"
        id="{uid}-panel-{panel.id}"
        aria-labelledby="{uid}-tab-{panel.id}"
        tabindex="0"
        class="ep-panel"
      >
        <!-- data-language lets the code decorator supply the chip and copy button. -->
        <pre data-code-block data-language={panel.language}><code
            >{#if bodyHtml}{@html bodyHtml}{:else}{panel.body}{/if}</code
          ></pre>
      </div>
    {/if}
  {/each}
</section>

<style>
  .ep {
    margin-block: 1rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-panel);
    overflow: hidden;
    background-color: var(--color-base-100);
  }

  .ep-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--color-edge);
    background-color: color-mix(in oklab, var(--ep-tone) 6%, var(--color-base-100));
    /* The tone is backed by a full-height rule so it reads without colour. */
    box-shadow: inset 3px 0 0 var(--ep-tone);
  }

  .ep-method {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--ep-tone);
    border: 1px solid color-mix(in oklab, var(--ep-tone) 45%, transparent);
    border-radius: var(--radius-chip);
    padding: 0.1rem 0.4rem;
  }

  .ep-path {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-base-content);
  }

  .ep-desc {
    flex: 1 1 16ch;
    font-size: var(--text-meta);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  }

  .ep-bar {
    border-bottom: 1px solid var(--color-edge);
    background-color: var(--color-base-200);
    overflow-x: auto;
  }

  .ep-tabs {
    display: flex;
    gap: 0.15rem;
    padding: 0.3rem 0.4rem 0;
  }

  .ep-tab {
    position: relative;
    flex-shrink: 0;
    padding: 0.35rem 0.7rem 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--text-meta);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    cursor: pointer;
    transition: color 120ms ease-out;
  }
  .ep-tab:hover {
    color: var(--color-base-content);
  }
  .ep-tab::after {
    content: '';
    position: absolute;
    inset-inline: 0.35rem;
    bottom: 0;
    height: 2px;
    border-radius: 1px;
    background-color: transparent;
  }
  .ep-tab.is-selected {
    color: var(--color-base-content);
    font-weight: 600;
  }
  .ep-tab.is-selected::after {
    background-color: var(--ep-tone);
  }

  .ep-panel:focus-visible {
    outline-offset: -2px;
  }

  .ep-panel pre {
    margin: 0;
    padding: 0.9rem 1.1rem;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.65;
    color: var(--color-base-content);
    background-color: var(--color-base-200);
  }

  .ep-panel :global(.code-block) {
    margin: 0;
    border: 0;
    border-radius: 0;
  }
</style>
