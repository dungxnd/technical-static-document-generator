<script lang="ts">
  import { ArrowLeft, ArrowRight } from '@lucide/svelte';
  import { docHref, docNeighbours } from '../routing';

  interface Props {
    docId: string;
  }

  let { docId }: Props = $props();

  const neighbours = $derived(docNeighbours(docId));
</script>

{#if neighbours.prev || neighbours.next}
  <nav class="page-nav" aria-label="Document navigation">
    {#if neighbours.prev}
      <a class="page-nav-link is-prev" href={docHref(neighbours.prev.id)} rel="prev">
        <span class="page-nav-hint">
          <ArrowLeft size={13} aria-hidden="true" />
          Previous
        </span>
        <span class="page-nav-title">{neighbours.prev.title}</span>
      </a>
    {:else}
      <span></span>
    {/if}

    {#if neighbours.next}
      <a class="page-nav-link is-next" href={docHref(neighbours.next.id)} rel="next">
        <span class="page-nav-hint">
          Next
          <ArrowRight size={13} aria-hidden="true" />
        </span>
        <span class="page-nav-title">{neighbours.next.title}</span>
      </a>
    {/if}
  </nav>
{/if}

<style>
  .page-nav {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--color-edge);
  }

  .page-nav-link {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.7rem 0.85rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-panel);
    background-color: var(--color-base-100);
    text-decoration: none;
    min-height: 44px;
    transition:
      border-color 130ms ease-out,
      background-color 130ms ease-out;
  }

  .page-nav-link:hover {
    border-color: var(--color-edge-strong);
    background-color: var(--color-base-200);
  }

  .page-nav-link.is-next {
    grid-column: 2;
    align-items: flex-end;
    text-align: end;
  }

  .page-nav-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }

  .page-nav-title {
    font-size: var(--text-body);
    font-weight: 560;
    color: var(--color-base-content);
  }

  @media (max-width: 480px) {
    .page-nav {
      grid-template-columns: 1fr;
    }
    .page-nav-link.is-next {
      grid-column: 1;
      align-items: flex-start;
      text-align: start;
    }
  }
</style>
