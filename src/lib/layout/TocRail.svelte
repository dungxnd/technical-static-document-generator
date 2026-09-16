<script lang="ts">
  import type { DocsHeading } from 'virtual:docs-index';

  interface Props {
    outline: DocsHeading[];
    docId: string;
    /** Written back so the shell can mirror state if it ever needs to. */
    activeId?: string | null;
  }

  let { outline, docId, activeId = $bindable<string | null>(null) }: Props = $props();

  /** The rail lists sections and subsections; the h1 is the page title. */
  const entries = $derived(outline.filter((heading) => heading.level >= 2 && heading.level <= 3));

  const HEADER_OFFSET = 88;

  $effect(() => {
    const ids = entries.map((entry) => entry.id);
    if (ids.length === 0) {
      activeId = null;
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      let current = ids[0];
      for (const id of ids) {
        const element = document.getElementById(id);
        if (!element) continue;
        if (element.getBoundingClientRect().top <= HEADER_OFFSET) current = id;
        else break;
      }
      // Reading the last section means nothing below it can become active.
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) {
        current = ids[ids.length - 1];
      }
      activeId = current;
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  });
</script>

{#if entries.length > 0}
  <nav class="toc" aria-labelledby="toc-heading">
    <p id="toc-heading" class="toc-title">On this page</p>
    <ul class="toc-list">
      {#each entries as entry (entry.id)}
        <li>
          <a
            class="toc-link"
            class:is-active={activeId === entry.id}
            class:is-nested={entry.level === 3}
            href="#/{docId}/{entry.id}"
            aria-current={activeId === entry.id ? 'location' : undefined}
          >
            {entry.text}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
{/if}

<style>
  .toc {
    font-size: var(--text-meta);
  }

  .toc-title {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
    margin-bottom: 0.6rem;
  }

  .toc-list {
    position: relative;
    display: flex;
    flex-direction: column;
    padding-inline-start: 2px;
  }

  /* The rail is 2px (kept faint) so the active marker can sit exactly on top of
     it. A 1px rail with a 2px marker can only ever share a left edge, which is
     what made the marker look 1px out of true. */
  .toc-list::before {
    content: '';
    position: absolute;
    inset-inline-start: 0;
    inset-block: 0.3rem;
    width: 2px;
    border-radius: 1px;
    background-color: color-mix(in oklab, var(--color-base-content) 10%, transparent);
  }

  .toc-link {
    position: relative;
    display: block;
    padding: 0.28rem 0 0.28rem 0.7rem;
    /* Pulled back so the marker covers the rail exactly. */
    margin-inline-start: -2px;
    border-inline-start: 2px solid transparent;
    border-radius: 1px;
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    text-decoration: none;
    line-height: 1.4;
    transition:
      color 120ms ease-out,
      border-color 120ms ease-out;
  }

  .toc-link.is-nested {
    padding-inline-start: 1.4rem;
  }

  .toc-link:hover {
    color: var(--color-base-content);
  }

  /* Active state carries weight and a filled marker, not colour alone. */
  .toc-link.is-active {
    color: var(--color-primary);
    border-inline-start-color: var(--color-primary);
    font-weight: 600;
  }
</style>
