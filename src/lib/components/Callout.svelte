<script lang="ts">
  import type { LucideIcon } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { CircleAlert, CircleCheck, Info, Lightbulb, TriangleAlert } from '@lucide/svelte';

  type CalloutType = 'info' | 'warning' | 'success' | 'error' | 'tip';

  interface Props {
    type?: CalloutType;
    title?: string;
    /** Optional direct text/content prop with inline markdown support. */
    text?: string;
    /** Alias for `text` */
    message?: string;
    children?: Snippet;
  }

  let { type = 'info', title, text, message, children }: Props = $props();

  /**
   * Parses lightweight inline Markdown (bold, italic, inline code, links)
   * safely when passed via text or message props.
   */
  function renderInlineMarkdown(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  const rawText = $derived(text || message || '');
  const renderedTextHtml = $derived(rawText ? renderInlineMarkdown(rawText) : null);

  /**
   * Colour comes from CSS (a `data-type` rule setting `--callout-accent`), so a
   * theme change repaints callouts with no JS. Only the icon and the default
   * label need to be language here.
   */
  const presentation: Record<CalloutType, { icon: LucideIcon; label: string }> = {
    info: { icon: Info, label: 'Note' },
    warning: { icon: TriangleAlert, label: 'Warning' },
    success: { icon: CircleCheck, label: 'Success' },
    error: { icon: CircleAlert, label: 'Danger' },
    tip: { icon: Lightbulb, label: 'Tip' },
  };

  const view = $derived(presentation[type] ?? presentation.info);
</script>

<aside class="callout" data-type={type} role="note" aria-label={title || view.label}>
  <span class="callout-icon" aria-hidden="true">
    <view.icon size={16} />
  </span>
  <div class="callout-body">
    <p class="callout-title">{title || view.label}</p>
    {#if children}
      {@render children()}
    {:else if renderedTextHtml}
      <p>{@html renderedTextHtml}</p>
    {/if}
  </div>
</aside>

<style>
  .callout {
    /* Overridden per type below — the single colour the callout is built on. */
    --callout-accent: var(--color-info);

    display: flex;
    gap: 0.7rem;
    align-items: flex-start;
    margin-block: 1.25rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--color-edge);
    border-inline-start: 3px solid var(--callout-accent);
    border-radius: var(--radius-panel);
    /* A 7% tint of the accent, on the page surface. */
    background-color: color-mix(in oklab, var(--callout-accent) 7%, var(--color-base-100));
  }

  .callout[data-type='warning'] {
    --callout-accent: var(--color-warning);
  }
  .callout[data-type='success'] {
    --callout-accent: var(--color-success);
  }
  .callout[data-type='error'] {
    --callout-accent: var(--color-error);
  }
  .callout[data-type='tip'] {
    --callout-accent: var(--color-accent);
  }

  .callout-icon {
    display: inline-flex;
    margin-top: 0.15rem;
    flex-shrink: 0;
    color: var(--callout-accent);
  }

  .callout-body {
    flex: 1;
    min-width: 0;
    font-size: var(--text-body);
    line-height: 1.62;
    /* Body text is base-content, never *-content: those are specified for the
       solid fill and fail contrast on a tint. */
    color: var(--color-base-content);
  }

  .callout-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    /* Type is carried by icon + label + colour, never colour alone. */
    color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
    margin-bottom: 0.3rem;
  }

  .callout-body :global(p) {
    margin: 0;
  }
  .callout-body :global(p + p) {
    margin-top: 0.6rem;
  }
  .callout-body :global(code) {
    background-color: var(--color-base-200);
    border: 1px solid var(--color-edge);
    padding: 0.1em 0.35em;
    border-radius: var(--radius-chip);
    font-size: 0.875em;
    font-family: var(--font-mono);
  }
  .callout-body :global(strong) {
    font-weight: 600;
    color: var(--color-base-content);
  }
  .callout-body :global(a) {
    color: var(--color-primary);
    text-underline-offset: 2px;
  }
</style>
