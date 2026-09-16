<script lang="ts">
  import { onMount } from 'svelte';
  import type { DocsHeading } from 'virtual:docs-index';
  import { sidebarConfig, defaultDocItem, findDocItem } from '../../config/sidebar';
  import { siteConfig } from '../../config/site';
  import { docHref, docNeighbours, parseHash, type Route } from '../routing';
  import { preferences } from '../preferences.svelte';
  import ThemeSwitcher from '../components/ThemeSwitcher.svelte';
  import SearchModal from '../components/SearchModal.svelte';
  import Router from './Router.svelte';
  import TocRail from './TocRail.svelte';
  import PageNav from './PageNav.svelte';
  import { Expand, Menu, Search, Shrink, X } from '@lucide/svelte';

  // Single source of truth for the route. Router receives it as props.
  let route = $state<Route>(parseHash(window.location.hash));
  let outline = $state<DocsHeading[]>([]);

  let isSidebarOpen = $state(false);
  let isSearchOpen = $state(false);
  let progress = $state(0);
  /** Drives `inert`: the drawer is only inert while it is an off-canvas drawer. */
  let isDesktop = $state(false);

  const activeDoc = $derived(findDocItem(route.docId) ?? defaultDocItem);
  const activeSection = $derived(
    sidebarConfig.find((section) => section.items.some((item) => item.id === route.docId)),
  );
  const neighbours = $derived(docNeighbours(route.docId));

  onMount(() => {
    if (!window.location.hash) {
      window.location.hash = docHref(defaultDocItem.id);
    }

    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    const syncDesktop = () => (isDesktop = desktopQuery.matches);
    syncDesktop();
    desktopQuery.addEventListener('change', syncDesktop);

    const syncRoute = () => {
      // Hashes that are not routes (the skip link) are left to the browser.
      if (!window.location.hash.startsWith('#/')) return;

      const next = parseHash(window.location.hash);
      if (next.docId !== route.docId) outline = [];
      route = next;
      isSidebarOpen = false;
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isSidebarOpen) {
        isSidebarOpen = false;
        return;
      }

      if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;

      // Never steal a word-jump from a field the reader is typing in.
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;

      const destination = event.key === 'ArrowLeft' ? neighbours.prev : neighbours.next;
      if (!destination) return;
      event.preventDefault();
      window.location.hash = docHref(destination.id);
    };

    let frame = 0;
    const measureProgress = () => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      progress = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measureProgress);
    };

    measureProgress();
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      desktopQuery.removeEventListener('change', syncDesktop);
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  });
</script>

<a class="skip-link" href="#main-content">Skip to content</a>

<div class="shell">
<header class="site-header">
  <div class="header-inner">
    <div class="header-side">
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square rounded-edge lg:hidden"
        onclick={() => (isSidebarOpen = !isSidebarOpen)}
        aria-label={isSidebarOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={isSidebarOpen}
      >
        {#if isSidebarOpen}
          <X size={16} aria-hidden="true" />
        {:else}
          <Menu size={16} aria-hidden="true" />
        {/if}
      </button>

      <a class="brand" href={docHref(defaultDocItem.id)}>
        <span class="brand-mark" aria-hidden="true">
          <siteConfig.icon size={15} />
        </span>
        <span class="brand-name">{siteConfig.name}</span>
        <span class="brand-badge">{siteConfig.badge}</span>
      </a>
    </div>

    <div class="header-side">
      <button
        type="button"
        class="search-trigger"
        onclick={() => (isSearchOpen = true)}
        aria-label="Search documentation"
        aria-keyshortcuts="Control+K"
      >
        <Search size={13} aria-hidden="true" />
        <span class="search-trigger-label">Search</span>
        <kbd class="search-trigger-kbd">Ctrl K</kbd>
      </button>

      <button
        type="button"
        class="width-toggle"
        onclick={() => preferences.toggleContentWidth()}
        aria-pressed={preferences.isWide}
        aria-label={preferences.isWide
          ? 'Switch content to a readable measure'
          : 'Switch content to full width'}
        title={preferences.isWide ? 'Readable measure' : 'Full width'}
      >
        {#if preferences.isWide}
          <Shrink size={14} aria-hidden="true" />
        {:else}
          <Expand size={14} aria-hidden="true" />
        {/if}
      </button>

      <ThemeSwitcher />
    </div>
  </div>
  <div class="progress-track" aria-hidden="true">
    <div class="progress-fill" style="transform: scaleX({progress})"></div>
  </div>
</header>

<div class="body-grid">
  <aside
    class="site-sidebar"
    class:is-open={isSidebarOpen}
    aria-label="Documentation"
    inert={!isDesktop && !isSidebarOpen}
  >
    <div class="sidebar-inner">
      {#each sidebarConfig as section (section.title)}
        <div class="nav-section">
          <p class="nav-section-title">
            {#if section.icon}
              <section.icon size={12} aria-hidden="true" />
            {/if}
            {section.title}
          </p>
          <ul class="nav-list">
            {#each section.items as item (item.id)}
              <li class="nav-item">
                <a
                  class="nav-link"
                  class:is-active={route.docId === item.id}
                  href={docHref(item.id)}
                  aria-current={route.docId === item.id ? 'page' : undefined}
                >
                  <span class="nav-link-title">{item.title}</span>
                  {#if item.badge}
                    <span class="nav-link-badge">{item.badge}</span>
                  {/if}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/each}

      {#if siteConfig.offlineNote}
        <p class="sidebar-note">{siteConfig.offlineNote}</p>
      {/if}
    </div>
  </aside>

  {#if isSidebarOpen}
    <div
      class="sidebar-scrim"
      role="presentation"
      onclick={() => (isSidebarOpen = false)}
    ></div>
  {/if}

  <main id="main-content" class="site-main" tabindex="-1">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <span>{activeSection?.title ?? 'Docs'}</span>
      <span class="breadcrumb-sep" aria-hidden="true">/</span>
      <span class="breadcrumb-current" aria-current="page">{activeDoc.title}</span>
    </nav>

    <Router
      docId={route.docId}
      section={route.section}
      unknown={route.unknown}
      bind:outline
    />

    {#if !route.unknown}
      <PageNav docId={route.docId} />
      {#if neighbours.total > 1}
        <p class="shortcut-hint">
          <kbd>Alt</kbd> <kbd>←</kbd> <kbd>→</kbd> to move between documents
        </p>
      {/if}
    {/if}
  </main>

  <div class="site-toc">
    <div class="toc-inner">
      <TocRail docId={route.docId} {outline} />
    </div>
  </div>
</div>
</div>

<SearchModal bind:isOpen={isSearchOpen} />

<style>
  .skip-link {
    position: fixed;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 100;
    padding: 0.5rem 0.85rem;
    border-radius: var(--radius-edge);
    background-color: var(--color-primary);
    color: var(--color-primary-content);
    font-size: var(--text-meta);
    font-weight: 600;
    text-decoration: none;
    transform: translateY(-200%);
  }
  .skip-link:focus-visible {
    transform: translateY(0);
  }

  /* ── page container ──────────────────────────────────────────────────────
     One definition of the horizontal box, shared by the header inner and the
     body grid. They used to carry their own max-width and padding, which had
     drifted apart — the brand sat 4px left of the sidebar, and on a wide
     screen the header was 120px narrower than the body. Resolving both to the
     same custom properties makes that impossible.
     ──────────────────────────────────────────────────────────────────────── */
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    --shell-max: 1560px;
    --shell-pad: 1rem;
  }

  @media (min-width: 1024px) {
    .shell {
      --shell-pad: 1.25rem;
    }
  }

  .header-inner,
  .body-grid {
    width: 100%;
    max-width: var(--shell-max);
    margin-inline: auto;
    padding-inline: var(--shell-pad);
  }

  /* ── header ── */
  .site-header {
    position: sticky;
    top: 0;
    z-index: 40;
    background-color: color-mix(in oklab, var(--color-base-100) 88%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--color-edge);
  }

  .header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    height: 3.5rem;
  }

  .header-side {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--color-base-content);
    min-width: 0;
  }

  .brand-mark {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-edge);
    background-color: var(--color-primary);
    color: var(--color-primary-content);
    flex-shrink: 0;
  }

  .brand-name {
    font-weight: 680;
    letter-spacing: -0.015em;
    font-size: 0.9375rem;
    white-space: nowrap;
  }

  .brand-badge {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    padding: 0.05rem 0.3rem;
  }

  .search-trigger {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 2rem;
    padding-inline: 0.6rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-edge);
    background-color: var(--color-base-200);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    font-size: var(--text-meta);
    cursor: pointer;
    transition:
      border-color 120ms ease-out,
      color 120ms ease-out;
  }
  .search-trigger:hover {
    border-color: var(--color-edge-strong);
    color: var(--color-base-content);
  }

  .search-trigger-label {
    display: none;
  }
  @media (min-width: 640px) {
    .search-trigger-label {
      display: inline;
    }
  }

  .search-trigger-kbd {
    display: none;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    padding: 0.05rem 0.28rem;
    background-color: var(--color-base-100);
  }
  @media (min-width: 768px) {
    .search-trigger-kbd {
      display: inline;
    }
  }

  .width-toggle {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-edge);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    cursor: pointer;
    transition:
      background-color 120ms ease-out,
      color 120ms ease-out;
  }
  .width-toggle:hover {
    background-color: var(--color-base-200);
    color: var(--color-base-content);
  }
  /* Pressed carries a surface as well as the icon swap. */
  .width-toggle[aria-pressed='true'] {
    background-color: var(--color-base-200);
    border-color: var(--color-edge);
    color: var(--color-base-content);
  }

  .progress-track {
    height: 1.5px;
    background-color: transparent;
  }
  .progress-fill {
    height: 100%;
    transform-origin: left;
    background-color: var(--color-primary);
    transition: transform 80ms linear;
  }

  /* ── body grid ── */
  .body-grid {
    /* Fills the remaining height; the shared container box is above. */
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  @media (min-width: 1024px) {
    .body-grid {
      grid-template-columns: 216px minmax(0, 1fr);
      column-gap: 1.75rem;
    }
  }

  @media (min-width: 1140px) {
    .body-grid {
      grid-template-columns: 216px minmax(0, 1fr) 176px;
      column-gap: 1.5rem;
    }
  }

  /* ── sidebar ── */
  .site-sidebar {
    grid-column: 1;
  }

  .sidebar-inner {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    padding-block: 1.25rem;
  }

  /* Sticks to the side of the viewport while the document scrolls. */
  @media (min-width: 1024px) {
    .sidebar-inner {
      position: sticky;
      top: 3.5rem;
      max-height: calc(100dvh - 3.5rem);
      overflow-y: auto;
      scrollbar-width: thin;
    }
  }

  .nav-section-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
    margin-bottom: 0.35rem;
  }

  /* Items hang off a guide line, joined by a curved elbow — the shape makes the
     parent/child relationship readable without extra indentation levels.
     Every stroke is 2px so the active marker aligns exactly with the rail. */
  .nav-list {
    position: relative;
    display: flex;
    flex-direction: column;
    padding-inline-start: 0.8rem;
  }

  .nav-item {
    position: relative;
  }

  /* Spine between consecutive items. Absent on the last item, so the line
     terminates at its elbow instead of running on past the end of the list. */
  .nav-item:not(:last-child)::before {
    content: '';
    position: absolute;
    inset-inline-start: -0.8rem;
    top: 0;
    bottom: 0;
    width: 2px;
    background-color: var(--color-edge);
  }

  .nav-item::after {
    content: '';
    position: absolute;
    inset-inline-start: -0.8rem;
    top: 0;
    height: 50%;
    width: 0.8rem;
    border-inline-start: 2px solid var(--color-edge);
    border-bottom: 2px solid var(--color-edge);
    border-end-start-radius: 6px;
    transition: border-color 120ms ease-out;
  }

  .nav-item:has(.nav-link.is-active)::after {
    border-color: var(--color-primary);
  }

  .nav-link {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.35rem 0.55rem;
    border-radius: var(--radius-edge);
    font-size: 0.875rem;
    color: color-mix(in oklab, var(--color-base-content) 74%, transparent);
    text-decoration: none;
    transition:
      background-color 120ms ease-out,
      color 120ms ease-out;
  }

  .nav-link:hover {
    background-color: var(--color-base-200);
    color: var(--color-base-content);
  }

  /* Active is marked by surface + weight + the coloured elbow above, never by
     colour alone. */
  .nav-link.is-active {
    background-color: color-mix(in oklab, var(--color-primary) 10%, var(--color-base-100));
    color: var(--color-base-content);
    font-weight: 600;
  }

  .nav-link-badge {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    padding: 0 0.25rem;
    flex-shrink: 0;
  }

  .sidebar-note {
    font-size: var(--text-micro);
    line-height: 1.5;
    color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
    padding-top: 1rem;
    border-top: 1px solid var(--color-edge);
  }

  .sidebar-scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
    background-color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
    backdrop-filter: blur(1px);
  }

  /* Below lg the sidebar becomes a drawer. */
  @media (max-width: 1023px) {
    .site-sidebar {
      position: fixed;
      inset-block: 0;
      inset-inline-start: 0;
      z-index: 35;
      width: 272px;
      padding-inline: 1rem;
      background-color: var(--color-base-100);
      border-inline-end: 1px solid var(--color-edge);
      overflow-y: auto;
      transform: translateX(-100%);
      transition: transform 200ms ease-out;
    }
    .site-sidebar.is-open {
      transform: translateX(0);
    }
  }

  /* ── main ── */
  .site-main {
    grid-column: 1;
    min-width: 0;
    padding-block: 1.5rem 3rem;
    /* Readable measure by default; the header toggle relaxes it to full width.
       Centring keeps the leftover space even on both sides of the column
       instead of dumping it all to the right of the article. */
    max-width: 76ch;
    margin-inline: auto;
  }
  @media (min-width: 1024px) {
    .site-main {
      grid-column: 2;
    }
  }
  :global(html[data-content-width='wide']) .site-main {
    max-width: none;
  }
  .site-main:focus {
    outline: none;
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
    margin-bottom: 1.5rem;
  }

  .breadcrumb-current {
    color: var(--color-base-content);
    font-weight: 600;
  }

  .shortcut-hint {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    justify-content: center;
    margin-top: 1.5rem;
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  }
  .shortcut-hint kbd {
    font-family: var(--font-mono);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    padding: 0 0.25rem;
  }

  /* ── toc rail ── */
  .site-toc {
    display: none;
  }
  @media (min-width: 1140px) {
    .site-toc {
      display: block;
      grid-column: 3;
    }
    .toc-inner {
      position: sticky;
      top: 4.5rem;
      max-height: calc(100dvh - 6rem);
      overflow-y: auto;
      padding-block: 1.75rem;
    }
  }
</style>
