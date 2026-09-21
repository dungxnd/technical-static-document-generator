<script lang="ts" module>
  let renderCount = 0;
</script>

<script lang="ts">
  import mermaid from 'mermaid';
  import Panzoom, { type PanzoomObject } from '@panzoom/panzoom';
  import { theme } from '../theme.svelte';
  import { readDiagramPalette } from '../diagram/palette';
  import {
    copySvgText,
    downloadSvgFile,
    exportPngFile,
    svgFileName,
  } from '../diagram/export-svg';
  import DiagramFrame, { type FrameExportItem } from './DiagramFrame.svelte';
  import { Code, Eye, RotateCcw, TriangleAlert, ZoomIn, ZoomOut } from '@lucide/svelte';

  interface Props {
    code: string;
    title?: string;
  }

  let { code, title = 'Diagram' }: Props = $props();

  let inlineHost = $state<HTMLDivElement | null>(null);
  let fullscreenHost = $state<HTMLDivElement | null>(null);
  let inlineViewport = $state<HTMLDivElement | null>(null);

  let svgMarkup = $state('');
  let status = $state<'rendering' | 'ready' | 'error'>('rendering');
  let errorMessage = $state('');
  let showSource = $state(false);
  let isFullscreen = $state(false);
  let inlineScale = $state(1);
  let fullscreenScale = $state(1);

  let inlinePanzoom: PanzoomObject | null = null;
  let fullscreenPanzoom: PanzoomObject | null = null;

  const MIN_SCALE = 0.4;
  const MAX_SCALE = 5;
  const activeScale = $derived(isFullscreen ? fullscreenScale : inlineScale);
  const canZoomIn = $derived(activeScale < MAX_SCALE - 0.01);
  const canZoomOut = $derived(activeScale > MIN_SCALE + 0.01);

  /**
   * Mermaid resolves its theme through a colour library that predates oklch, so
   * it reads the hex `--diagram-*` palette rather than the oklch roles — the
   * same palette the SVG export uses, so a diagram and its export cannot drift.
   */
  function diagramTheme() {
    const palette = readDiagramPalette();
    return {
      fontFamily: palette.fontMono,
      background: palette.surface,
      primaryColor: palette.node,
      primaryTextColor: palette.text,
      primaryBorderColor: palette.border,
      secondaryColor: palette.nodeAlt,
      secondaryTextColor: palette.text,
      secondaryBorderColor: palette.border,
      tertiaryColor: palette.nodeAlt,
      tertiaryTextColor: palette.text,
      tertiaryBorderColor: palette.border,
      lineColor: palette.line,
      textColor: palette.text,
      edgeLabelBackground: palette.surface,
      clusterBkg: palette.nodeAlt,
      clusterBorder: palette.border,
      noteBkgColor: palette.nodeAlt,
      noteTextColor: palette.text,
      noteBorderColor: palette.border,
    };
  }

  async function renderDiagram() {
    status = 'rendering';
    errorMessage = '';
    try {
      mermaid.initialize({
        startOnLoad: false,
        // 'strict' rather than 'loose': loose permits javascript: links and
        // raw HTML inside diagram labels.
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: diagramTheme(),
        // Dagre rather than the ELK layout Mermaid 12 uses by default: ELK is
        // ~1.4 MB and a single-file artifact cannot load it lazily, so
        // adaptive-mermaid prunes it. Naming `elk` here — or `layout: elk` in a
        // diagram — keeps it for the whole build.
        layout: 'dagre',
        flowchart: { curve: 'basis', padding: 12 },
      });

      const id = `mermaid-${++renderCount}`;
      const { svg } = await mermaid.render(id, code.trim());
      svgMarkup = svg;
      status = 'ready';
    } catch (cause) {
      status = 'error';
      errorMessage =
        cause instanceof Error ? cause.message : 'The diagram could not be rendered.';
    }
  }

  /** Injects markup into a host and wires pan/zoom, returning a teardown. */
  function mountDiagram(
    host: HTMLDivElement,
    wheelTarget: HTMLElement | null,
    assign: (instance: PanzoomObject | null) => void,
    onScale: (value: number) => void,
  ): () => void {
    host.innerHTML = svgMarkup;
    const svg = host.querySelector('svg');
    if (!svg) return () => {};

    // Mermaid emits width="100%" plus an inline max-width derived from the
    // diagram's natural size. Left alone, a tall diagram sizes to the container
    // width and overflows far below the viewport. Boxing it to the host and
    // letting preserveAspectRatio letterbox keeps the whole diagram visible.
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.maxWidth = '100%';
    svg.style.maxHeight = '100%';
    svg.style.display = 'block';
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const instance = Panzoom(svg, {
      maxScale: MAX_SCALE,
      minScale: MIN_SCALE,
      contain: 'outside',
      cursor: 'grab',
      canvas: true,
    });
    assign(instance);

    // addEventListener, not `onwheel =` — assigning would clobber other handlers.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      instance.zoomWithWheel(event);
      onScale(instance.getScale());
    };
    wheelTarget?.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      wheelTarget?.removeEventListener('wheel', onWheel);
      instance.destroy();
      assign(null);
    };
  }

  // Re-render on mount and whenever the preset changes. Keyed on the preset
  // rather than the colour scheme: two presets can share a scheme, and the
  // diagram has to pick up their colours too.
  $effect(() => {
    void theme.name;
    void renderDiagram();
  });

  $effect(() => {
    if (status !== 'ready' || showSource || !inlineHost) return;
    return mountDiagram(
      inlineHost,
      inlineViewport,
      (instance) => {
        inlinePanzoom = instance;
        if (instance) inlineScale = instance.getScale();
      },
      (value) => (inlineScale = value),
    );
  });

  $effect(() => {
    if (!isFullscreen || status !== 'ready' || !fullscreenHost) return;
    return mountDiagram(
      fullscreenHost,
      fullscreenHost.parentElement,
      (instance) => (fullscreenPanzoom = instance),
      (value) => (fullscreenScale = value),
    );
  });

  function zoomBy(factor: number, instance: PanzoomObject | null, assign: (value: number) => void) {
    if (!instance) return;
    if (factor > 1) instance.zoomIn();
    else instance.zoomOut();
    assign(instance.getScale());
  }

  function reset(instance: PanzoomObject | null, assign: (value: number) => void) {
    instance?.reset();
    if (instance) assign(instance.getScale());
  }

  /**
   * Serialises the last good render rather than the live node: the inline host
   * is unmounted while the source view is showing, and the DOM copy has had its
   * sizing attributes rewritten for the box it sits in. A background is added
   * because the exported file lands on paper we do not control.
   */
  function diagramSvg(): string {
    if (!svgMarkup) throw new Error('The diagram has not finished rendering yet.');

    const parsed = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
    const svg = parsed.documentElement;
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    const viewBox = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    const [, , width, height] =
      viewBox && viewBox.length === 4
        ? viewBox
        : [0, 0, svg.clientWidth || 1200, svg.clientHeight || 600];

    svg.setAttribute('width', String(Math.round(width)));
    svg.setAttribute('height', String(Math.round(height)));

    const background = parsed.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', readDiagramPalette().surface);
    svg.insertBefore(background, svg.firstChild);

    return new XMLSerializer().serializeToString(svg);
  }

  const exportItems: FrameExportItem[] = [
    {
      id: 'svg',
      label: 'Download SVG',
      run: () => {
        const name = svgFileName(title, 'svg');
        downloadSvgFile(diagramSvg(), name);
        return `Saved ${name}`;
      },
    },
    {
      id: 'png',
      label: 'Download PNG',
      run: async () => {
        const name = svgFileName(title, 'png');
        await exportPngFile(diagramSvg(), name);
        return `Saved ${name}`;
      },
    },
    {
      id: 'copy',
      label: 'Copy SVG source',
      run: async () =>
        (await copySvgText(diagramSvg()))
          ? 'SVG source copied'
          : 'The clipboard is unavailable',
    },
  ];
</script>

{#snippet actions()}
  <button
    type="button"
    class="diagram-btn"
    aria-pressed={showSource}
    onclick={() => (showSource = !showSource)}
  >
    {#if showSource}
      <Eye size={12} aria-hidden="true" /> Diagram
    {:else}
      <Code size={12} aria-hidden="true" /> Source
    {/if}
  </button>

  {#if !showSource}
    <span class="diagram-group">
      <button
        type="button"
        class="diagram-btn is-icon"
        onclick={() => zoomBy(1.4, inlinePanzoom, (value) => (inlineScale = value))}
        disabled={!canZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <ZoomIn size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        class="diagram-btn is-icon"
        onclick={() => zoomBy(0.7, inlinePanzoom, (value) => (inlineScale = value))}
        disabled={!canZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <ZoomOut size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        class="diagram-btn is-icon"
        onclick={() => reset(inlinePanzoom, (value) => (inlineScale = value))}
        aria-label="Reset view"
        title="Reset view"
      >
        <RotateCcw size={13} aria-hidden="true" />
      </button>
    </span>
  {/if}
{/snippet}

{#snippet footer()}
  <p class="diagram-hint">
    {#if showSource}
      Mermaid source. Add <code>accTitle:</code> and <code>accDescr:</code> lines to describe the
      diagram for screen readers.
    {:else}
      Scroll to zoom, drag to pan. Use the arrow keys to read the surrounding text.
    {/if}
  </p>
{/snippet}

{#snippet fullscreenBody()}
  <div class="diagram-canvas is-fullscreen" bind:this={fullscreenHost}></div>
{/snippet}

{#snippet fullscreenActions()}
  <span class="diagram-group">
    <button
      type="button"
      class="diagram-btn is-icon"
      onclick={() => zoomBy(1.4, fullscreenPanzoom, (value) => (fullscreenScale = value))}
      disabled={!canZoomIn}
      aria-label="Zoom in"
    >
      <ZoomIn size={14} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="diagram-btn is-icon"
      onclick={() => zoomBy(0.7, fullscreenPanzoom, (value) => (fullscreenScale = value))}
      disabled={!canZoomOut}
      aria-label="Zoom out"
    >
      <ZoomOut size={14} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="diagram-btn is-icon"
      onclick={() => reset(fullscreenPanzoom, (value) => (fullscreenScale = value))}
      aria-label="Reset view"
    >
      <RotateCcw size={14} aria-hidden="true" />
    </button>
  </span>
{/snippet}

<figure class="diagram" aria-label={title}>
  <DiagramFrame
    {title}
    {exportItems}
    {actions}
    {footer}
    fullscreen={fullscreenBody}
    {fullscreenActions}
    bind:open={isFullscreen}
  >
    {#if showSource}
      <pre class="diagram-source" data-code-block data-language="mermaid"><code>{code.trim()}</code
        ></pre>
    {:else if status === 'error'}
      <div class="diagram-error" role="alert">
        <TriangleAlert size={15} aria-hidden="true" />
        <div>
          <p class="diagram-error-title">This diagram has a syntax error</p>
          <p class="diagram-error-body">{errorMessage}</p>
        </div>
      </div>
    {:else}
      <div class="diagram-viewport" bind:this={inlineViewport}>
        <div
          class="diagram-canvas"
          class:is-rendering={status === 'rendering'}
          bind:this={inlineHost}
        ></div>
        {#if status === 'rendering'}
          <p class="diagram-loading" role="status">Rendering diagram…</p>
        {/if}
      </div>
    {/if}
  </DiagramFrame>
</figure>

<style>
  .diagram {
    margin-block: 1.25rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-panel);
    overflow: hidden;
    background-color: var(--color-base-100);
  }

  .diagram-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.5rem;
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
  .diagram-btn.is-icon {
    border-color: transparent;
    padding: 0.25rem;
    background-color: transparent;
  }
  .diagram-btn:hover:not(:disabled) {
    border-color: var(--color-edge-strong);
    color: var(--color-base-content);
  }
  .diagram-group .diagram-btn.is-icon:hover:not(:disabled) {
    background-color: var(--color-base-200);
    border-color: transparent;
  }
  .diagram-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .diagram-viewport {
    position: relative;
    height: 22rem;
    overflow: hidden;
    background-color: var(--color-base-100);
    touch-action: none;
  }

  .diagram-canvas {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    transition: opacity 140ms ease-out;
  }
  .diagram-canvas.is-rendering {
    opacity: 0.25;
  }

  .diagram-loading {
    position: absolute;
    inset-inline: 0;
    top: 50%;
    text-align: center;
    font-size: var(--text-meta);
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }

  .diagram-source {
    margin: 0;
    padding: 0.9rem 1.1rem;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.65;
    color: var(--color-base-content);
    background-color: var(--color-base-200);
  }
  .diagram-source + :global(*) {
    margin-top: 0;
  }

  .diagram-error {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.85rem 1rem;
    border-inline-start: 3px solid var(--color-error);
    background-color: color-mix(in oklab, var(--color-error) 7%, var(--color-base-100));
  }
  .diagram-error-title {
    font-size: var(--text-meta);
    font-weight: 640;
    color: var(--color-base-content);
  }
  .diagram-error-body {
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 68%, transparent);
    white-space: pre-wrap;
  }

  .diagram-hint {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.75rem;
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  }
  .diagram-hint code {
    font-family: var(--font-mono);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    padding: 0 0.2rem;
  }

  .diagram-canvas.is-fullscreen {
    height: 100%;
    padding: 2rem;
    touch-action: none;
  }
</style>
