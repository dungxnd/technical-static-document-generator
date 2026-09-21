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
  import { ChevronDown, Expand, Menu, Search, Shrink, X } from '@lucide/svelte';

  // Single source of truth for the route. Router receives it as props.
  let route = $state<Route>(parseHash(window.location.hash));
  let outline = $state<DocsHeading[]>([]);

  let isSidebarOpen = $state(false);
  let isSearchOpen = $state(false);
  let progress = $state(0);
  /** Drives `inert`: the drawer is only inert while it is an off-canvas drawer. */
  let isDesktop = $state(false);
  /** The reader's own choice for the outline panel, ignored while it is a rail. */
  let isTocOpen = $state(false);
  /** At or above the rail breakpoint the outline is a column, not a disclosure. */
  let isTocRail = $state(false);

  const activeDoc = $derived(findDocItem(route.docId) ?? defaultDocItem);
  const activeSection = $derived(
    sidebarConfig.find((section) => section.items.some((item) => item.id === route.docId)),
  );
  const neighbours = $derived(docNeighbours(route.docId));
  /** The outline only lists sections and subsections; the h1 is the page title. */
  const hasOutline = $derived(outline.some((heading) => heading.level >= 2 && heading.level <= 3));

  /**
   * The drawer is a modal surface: the page behind it must not scroll away
   * under the reader. The scrollbar width is handed to CSS so removing the
   * scrollbar does not shuffle the whole shell sideways.
   */
  $effect(() => {
    if (!isSidebarOpen || isDesktop) return;

    const root = document.documentElement;
    const gutter = window.innerWidth - root.clientWidth;
    root.style.setProperty('--scroll-lock-gutter', `${gutter}px`);
    root.classList.add('is-scroll-locked');

    return () => {
      root.classList.remove('is-scroll-locked');
      root.style.removeProperty('--scroll-lock-gutter');
    };
  });

  onMount(() => {
    if (!window.location.hash) {
      window.location.hash = docHref(defaultDocItem.id);
    }

    // Breakpoints are declared in rem in the stylesheet, so they have to be in
    // rem here too — a px query would drift from the CSS (and from Tailwind's
    // own `lg:` utilities) as soon as the root font size is not 16px.
    const desktopQuery = window.matchMedia('(min-width: 64rem)');
    const railQuery = window.matchMedia('(min-width: 71.25rem)');
    const syncDesktop = () => (isDesktop = desktopQuery.matches);
    const syncRail = () => (isTocRail = railQuery.matches);
    syncDesktop();
    syncRail();
    desktopQuery.addEventListener('change', syncDesktop);
    railQuery.addEventListener('change', syncRail);

    const syncRoute = () => {
      // Hashes that are not routes (the skip link) are left to the browser.
      if (!window.location.hash.startsWith('#/')) return;

      const next = parseHash(window.location.hash);
      if (next.docId !== route.docId) outline = [];
      route = next;
      isSidebarOpen = false;
      // Collapsing before the router scrolls to the section keeps the landing
      // position honest: the panel is above the article, so leaving it open
      // while the scroll runs would land the reader past their heading.
      isTocOpen = false;
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
      railQuery.removeEventListener('change', syncRail);
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
        {#if siteConfig.logoSvg}
          <span class="brand-logo" aria-hidden="true">
            {@html siteConfig.logoSvg}
          </span>
        {:else if siteConfig.logoSrc}
          <img class="brand-logo-img" src={siteConfig.logoSrc} alt="" aria-hidden="true" />
        {:else if siteConfig.icon}
          <span class="brand-mark" aria-hidden="true">
            <siteConfig.icon size={18} />
          </span>
        {/if}
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
    aria-label="Documentation navigation"
    inert={!isDesktop && !isSidebarOpen}
  >
    <div class="sidebar-mobile-header lg:hidden">
      <div class="brand">
        {#if siteConfig.logoSvg}
          <span class="brand-logo" aria-hidden="true">
            {@html siteConfig.logoSvg}
          </span>
        {:else if siteConfig.logoSrc}
          <img class="brand-logo-img" src={siteConfig.logoSrc} alt="" aria-hidden="true" />
        {:else if siteConfig.icon}
          <span class="brand-mark" aria-hidden="true">
            <siteConfig.icon size={18} />
          </span>
        {/if}
        <span class="brand-name">{siteConfig.name}</span>
      </div>
      <button
        type="button"
        class="sidebar-close-btn"
        onclick={() => (isSidebarOpen = false)}
        aria-label="Close navigation"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>

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
    <!-- One outline, two shapes: a disclosure above the article while the
         viewport is narrow, the sticky rail beside it once it is wide. Both
         come from the same TocRail, so its scroll spy runs exactly once.
         A plain button and a hidden panel rather than <details>: a sticky
         element inside <details> does not stick in Chromium. -->
    {#if hasOutline}
      <button
        type="button"
        class="toc-summary"
        aria-expanded={isTocOpen}
        aria-controls="toc-outline"
        onclick={() => (isTocOpen = !isTocOpen)}
      >
        <span>On this page</span>
        <span class="toc-summary-chevron" aria-hidden="true">
          <ChevronDown size={14} />
        </span>
      </button>
    {/if}
    <div class="toc-inner" id="toc-outline" hidden={!hasOutline || (!isTocRail && !isTocOpen)}>
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

     Every breakpoint in this file is in rem, matching the Tailwind utilities
     used in the markup (`lg:hidden`, `sm:`) and the reader's own font size. A
     px query would silently drift from them the moment the root font size is
     not 16px — the sidebar would go off-canvas while the hamburger stayed
     hidden, leaving no way to reach the navigation at all.

     The width ladder, low to high:
       < 40rem    phone       · drawer nav, icon-only search, no brand badge
       ≥ 40rem    large phone · search label, brand badge
       ≥ 48rem    tablet      · shortcut hint, width toggle
       ≥ 64rem    laptop      · sidebar column, outline disclosed above article
       ≥ 71.25rem wide        · outline becomes its own sticky rail
     ──────────────────────────────────────────────────────────────────────── */

  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    --shell-max: 97.5rem;
    /* Padding grows with the viewport instead of stepping at one breakpoint,
       and gives back the difference to the text on a narrow phone. */
    --shell-pad: clamp(0.75rem, 3vw, 1.25rem);
    /* The readable measure, shared by the article and the outline above it so
       the two stay in the same column instead of drifting apart. */
    --content-measure: 76ch;
  }

  :global(html[data-content-width='wide']) .shell {
    --content-measure: 100%;
  }

  .header-inner,
  .body-grid {
    width: 100%;
    max-width: var(--shell-max);
    margin-inline: auto;
    /* The viewport is declared `viewport-fit=cover`, so the insets are real:
       without them the first characters sit under a notch in landscape. */
    padding-inline: max(
      var(--shell-pad),
      env(safe-area-inset-left, 0px),
      env(safe-area-inset-right, 0px)
    );
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
    color: var(--color-primary);
    background: transparent;
    flex-shrink: 0;
  }

  .brand-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: auto;
    height: 1.75rem;
    max-height: 1.75rem;
    color: var(--color-base-content);
    background: transparent;
    flex-shrink: 0;
  }

  .brand-logo :global(svg) {
    width: auto;
    height: 1.75rem;
    max-height: 1.75rem;
    max-width: 10rem;
    fill: currentColor;
  }

  .brand-logo-img {
    height: 1.75rem;
    width: auto;
    max-width: 10rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .brand-name {
    font-weight: 680;
    letter-spacing: -0.015em;
    font-size: 0.9375rem;
    white-space: nowrap;
    /* The name is configuration, so it may be long: truncate rather than let
       it push the search trigger and theme switch off the edge. */
    overflow: hidden;
    text-overflow: ellipsis;
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
    flex-shrink: 0;
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
  @media (min-width: 40rem) {
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
  @media (min-width: 48rem) {
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

  /* Progressive disclosure: the badge is decoration and goes first, then the
     width toggle — which cannot do anything while the viewport is narrower
     than the readable measure it relaxes. Both rules sit after the elements
     they switch off: same specificity, so source order is what decides. */
  @media (max-width: 39.99rem) {
    .brand-badge {
      display: none;
    }
  }

  @media (max-width: 47.99rem) {
    .width-toggle {
      display: none;
    }
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

  /* ── body grid ──
     Two rows at every width, so the outline panel always has somewhere to sit
     above the article:

       narrow              sidebar | main        wide
       ┌──────────────┐    ┌───┬──────────┐    ┌───┬──────┬────┐
       │ outline      │    │   │ outline  │    │   │ main │toc │
       ├──────────────┤    │nav├──────────┤    │nav│      │    │
       │ article      │    │   │ article  │    │   │      │    │
       └──────────────┘    └───┴──────────┘    └───┴──────┴────┘

     The sidebar stays out of flow until 64rem, where it is a fixed drawer and
     a grid column is not a box it occupies. */
  .body-grid {
    /* Fills the remaining height; the shared container box is above. */
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .site-sidebar {
    grid-column: 1;
  }

  .site-toc {
    grid-column: 1;
    grid-row: 1;
  }

  @media (min-width: 64rem) {
    .body-grid {
      grid-template-columns: 13.5rem minmax(0, 1fr);
      column-gap: 1.75rem;
    }
    .site-sidebar {
      grid-row: 1 / span 2;
    }
    .site-toc {
      grid-column: 2;
    }
  }

  @media (min-width: 71.25rem) {
    .body-grid {
      grid-template-columns: 13.5rem minmax(0, 1fr) 11rem;
      column-gap: 1.5rem;
    }
    .site-sidebar {
      grid-row: 1;
    }
    .site-toc {
      grid-column: 3;
    }
  }

  .sidebar-inner {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    padding-block: 1.25rem;
  }

  /* Sticks to the side of the viewport while the document scrolls. */
  @media (min-width: 64rem) {
    .sidebar-inner {
      position: sticky;
      top: 3.5rem;
      max-height: calc(100dvh - 3.5rem);
      overflow-y: auto;
      /* Reaching the end of the navigation must not start scrolling the
         document behind it. */
      overscroll-behavior: contain;
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

  .sidebar-mobile-header {
    display: none;
  }

  .sidebar-scrim {
    position: fixed;
    inset: 0;
    z-index: 45;
    background-color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
    backdrop-filter: blur(2px);
  }

  /* Below the laptop breakpoint the sidebar becomes a drawer. */
  @media (max-width: 63.99rem) {
    .site-sidebar {
      position: fixed;
      top: 0;
      bottom: 0;
      inset-inline-start: 0;
      z-index: 50;
      width: min(18rem, 85vw);
      display: flex;
      flex-direction: column;
      background-color: var(--color-base-100);
      border-inline-end: 1px solid var(--color-edge);
      box-shadow: 0 0 24px -4px color-mix(in oklab, var(--color-base-content) 20%, transparent);
      /* Which way the drawer leaves. A variable rather than a second transform
         rule, so `.is-open` below stays the only thing that decides whether it
         is in view — a `html[dir]` selector would out-weigh it. */
      --drawer-shift: -100%;
      transform: translateX(var(--drawer-shift));
      transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    /* The drawer is pinned to the inline start, so it has to leave towards the
       inline start too — a physical -100% would slide it in from the wrong
       edge once the document is right-to-left. */
    :global(html[dir='rtl']) .site-sidebar {
      --drawer-shift: 100%;
    }
    .site-sidebar.is-open {
      transform: translateX(0);
    }
    .sidebar-mobile-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--color-edge);
      background-color: var(--color-base-200);
    }
    .sidebar-close-btn {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: var(--radius-chip);
      border: 1px solid var(--color-edge);
      background-color: var(--color-base-100);
      color: var(--color-base-content);
      cursor: pointer;
    }
    .sidebar-close-btn:hover {
      background-color: var(--color-base-300);
    }
    .site-sidebar .sidebar-inner {
      flex: 1;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-inline: 1rem;
      /* Clears the home indicator on a full-bleed phone. */
      padding-block: 1rem calc(2rem + env(safe-area-inset-bottom, 0px));
    }
    .nav-link {
      padding: 0.5rem 0.65rem;
      min-height: 40px;
    }
  }

  /* ── main ── */
  .site-main {
    grid-column: 1;
    grid-row: 2;
    min-width: 0;
    width: 100%;
    padding-block: 1.5rem 3rem;
    /* Readable measure by default; the header toggle relaxes it to full width.
       Centring keeps the leftover space even on both sides of the column
       instead of dumping it all to the right of the article. */
    max-width: var(--content-measure);
    margin-inline: auto;
  }
  @media (min-width: 64rem) {
    .site-main {
      grid-column: 2;
    }
  }
  @media (min-width: 71.25rem) {
    .site-main {
      grid-row: 1;
    }
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

  /* ── outline: disclosure, then rail ──
     The panel is a block child of a full-height grid item, which is what gives
     the sticky rail somewhere to travel. It must not grow to fill that item —
     a sticky box the height of its own containing block can never move. */
  .toc-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 0.75rem;
    border: 0;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-align: start;
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    cursor: pointer;
    user-select: none;
  }
  .toc-summary:hover {
    color: var(--color-base-content);
  }
  .toc-summary-chevron {
    display: grid;
    place-items: center;
    transition: transform 160ms ease-out;
  }
  .toc-summary[aria-expanded='true'] .toc-summary-chevron {
    transform: rotate(180deg);
  }

  @media (max-width: 71.24rem) {
    .site-toc {
      width: 100%;
      /* Same measure as the article below it, so the panel does not overhang
         the text it belongs to. */
      max-width: var(--content-measure);
      margin-inline: auto;
      padding-block-start: 1.25rem;
    }
    /* The summary is the lid of the panel: it keeps its top corners, the list
       below continues the same box. */
    .toc-summary {
      border: 1px solid var(--color-edge);
      border-radius: var(--radius-panel);
      background-color: var(--color-base-100);
    }
    .toc-summary[aria-expanded='true'] {
      border-end-start-radius: 0;
      border-end-end-radius: 0;
    }
    .toc-inner {
      padding: 0.1rem 0.75rem 0.75rem;
      border: 1px solid var(--color-edge);
      border-block-start: 0;
      border-start-start-radius: 0;
      border-start-end-radius: 0;
      border-end-start-radius: var(--radius-panel);
      border-end-end-radius: var(--radius-panel);
      background-color: var(--color-base-100);
    }
    /* The summary carries this label at this width; the rail's own would be a
       second "On this page" directly under the first. */
    .toc-inner :global(.toc-title) {
      display: none;
    }
  }

  @media (min-width: 71.25rem) {
    /* The rail is always shown, so its toggle would only offer to collapse
       something the layout has already committed to. */
    .toc-summary {
      display: none;
    }
    .toc-inner {
      position: sticky;
      top: 4.5rem;
      max-height: calc(100dvh - 6rem);
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-block: 1.75rem;
    }
  }

  /* ── print ──
     The document is the artifact: chrome, navigation and the outline are all
     interactions, and paper has none of them. */
  @media print {
    .site-header,
    .site-sidebar,
    .site-toc,
    .sidebar-scrim,
    .breadcrumb,
    .shortcut-hint {
      display: none !important;
    }
    .body-grid {
      display: block;
    }
  }
</style>
