<script lang="ts">
  import type { Component } from 'svelte';
  import type { DocsHeading } from 'virtual:docs-index';
  import { defaultDocItem, findDocItem } from '../../config/sidebar';
  import { siteConfig } from '../../config/site';
  import { decorateCode } from '../actions/decorate-code';
  import { decorateHeadings, scrollToSection } from '../actions/decorate-headings';
  import { TriangleAlert } from '@lucide/svelte';

  interface Props {
    docId: string;
    section: string | null;
    /** The hash named a document that does not exist. */
    unknown: boolean;
    /** Written on every successful load so the shell can render the TOC rail. */
    outline?: DocsHeading[];
  }

  let { docId, section, unknown, outline = $bindable([]) }: Props = $props();

  let articleEl = $state<HTMLElement | null>(null);
  let Loaded = $state<Component | null>(null);
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let errorMessage = $state('');
  let attempt = $state(0);

  const doc = $derived(findDocItem(docId) ?? defaultDocItem);

  $effect(() => {
    // `attempt` re-runs this for the retry button; it is deliberately read.
    void attempt;
    const target = doc;
    let cancelled = false;

    status = 'loading';
    errorMessage = '';
    Loaded = null;

    target
      .loader()
      .then((module) => {
        if (cancelled) return;
        Loaded = module.default;
        status = 'ready';
        document.title = `${target.title} · ${siteConfig.name}`;
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        status = 'error';
        errorMessage = cause instanceof Error ? cause.message : 'The document could not be loaded.';
      });

    return () => {
      cancelled = true;
    };
  });

  // Decoration runs after the component has been committed to the DOM.
  $effect(() => {
    if (status !== 'ready' || !Loaded || !articleEl) return;

    const undecorateCode = decorateCode(articleEl);
    outline = decorateHeadings(articleEl, doc.id);

    return undecorateCode;
  });

  // Declared after the decoration effect so heading ids exist by the time we
  // scroll to one. `section` changing within a document re-runs only this.
  $effect(() => {
    if (status !== 'ready' || !Loaded) return;
    if (section && scrollToSection(section)) return;
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
</script>

<div class="route" aria-busy={status === 'loading'}>
  {#if status === 'loading'}
    <div class="skeleton" aria-hidden="true">
      <div class="skeleton-line w-2/5 h-6"></div>
      <div class="skeleton-line w-full"></div>
      <div class="skeleton-line w-11/12"></div>
      <div class="skeleton-line w-3/4"></div>
      <div class="skeleton-block"></div>
      <div class="skeleton-line w-full"></div>
      <div class="skeleton-line w-5/6"></div>
    </div>
    <p class="sr-only" role="status">Loading {doc.title}</p>
  {:else if status === 'error'}
    <div class="route-error" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div>
        <h2>This document failed to load</h2>
        <p>{errorMessage}</p>
        <button type="button" class="btn btn-sm btn-outline rounded-edge mt-3" onclick={() => attempt++}>
          Try again
        </button>
      </div>
    </div>
  {:else if unknown}
    <div class="route-notice">
      <h1>That page does not exist</h1>
      <p>
        No document is registered for <code>{docId}</code>. Pick one from the navigation, or start
        at <a href="#/{defaultDocItem.id}">{defaultDocItem.title}</a>.
      </p>
    </div>
  {:else if Loaded}
    <article class="prose" bind:this={articleEl}>
      <Loaded />
    </article>
  {/if}
</div>

<style>
  .route {
    min-height: 50vh;
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-block: 0.5rem;
  }

  .skeleton-line,
  .skeleton-block {
    height: 0.85rem;
    border-radius: var(--radius-chip);
    background-color: var(--color-base-200);
    animation: skeleton-pulse 1.4s ease-in-out infinite;
  }

  .skeleton-block {
    height: 9rem;
    margin-block: 0.5rem;
  }

  @keyframes skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }

  .route-error,
  .route-notice {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    padding: 1rem 1.1rem;
    margin-block: 1rem;
    border: 1px solid var(--color-edge);
    border-inline-start: 3px solid var(--color-error);
    border-radius: var(--radius-panel);
    background-color: var(--color-base-100);
  }

  .route-notice {
    border-inline-start-color: var(--color-edge-strong);
    flex-direction: column;
    align-items: stretch;
  }

  .route-error h2,
  .route-notice h1 {
    font-size: var(--text-body);
    font-weight: 640;
    margin: 0 0 0.25rem;
  }

  .route-error p,
  .route-notice p {
    font-size: var(--text-meta);
    color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
    margin: 0;
  }
</style>
