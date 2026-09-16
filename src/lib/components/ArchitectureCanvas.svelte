<script lang="ts">
  /**
   * Interactive architecture canvas.
   *
   * The parent owns the spec: selection, diagnostics, the legend, the node
   * inspector and the canonical exports. The drawing lives in ArchitectureGraph,
   * which is also mounted a second time behind the fullscreen control — the fit
   * is relative to its viewport, so each copy lays out for itself.
   */
  import { Bug, RotateCcw, TriangleAlert, X, ZoomIn, ZoomOut } from '@lucide/svelte';

  import ArchitectureGraph, {
    type GraphControls,
    type GraphMeasurement,
  } from './ArchitectureGraph.svelte';
  import DiagramFrame, { type FrameExportItem } from './DiagramFrame.svelte';
  import { NODE_ICONS } from '../diagram/icons';
  import {
    BOUNDARY_META,
    TYPE_META,
    nodeVariant,
    type ArchBoundary,
    type ArchConnection,
    type ArchNode,
    type Box,
    type DiagramDiagnostic,
    type NodeType,
  } from '../diagram/types';
  import { boundaryRect } from '../diagram/geometry';
  import { countBySeverity, validateDiagram } from '../diagram/validate';
  import {
    buildDiagramSvg,
    copySvgText,
    downloadSvgFile,
    exportPngFile,
    svgFileName,
  } from '../diagram/export-svg';
  import { readDiagramThemes, type DiagramTheme } from '../diagram/palette';
  import { theme } from '../theme.svelte';

  export type { ArchNode, ArchConnection, ArchBoundary, NodeType };

  interface Props {
    title?: string;
    nodes: ArchNode[];
    connections?: ArchConnection[];
    boundaries?: ArchBoundary[];
    interactive?: boolean;
  }

  let {
    title = 'System architecture',
    nodes = [],
    connections = [],
    boundaries = [],
    interactive = true,
  }: Props = $props();

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3;

  let selectedId = $state<string | null>(null);
  let isFullscreen = $state(false);
  let showDiagnostics = $state(false);
  let diagnostics = $state<DiagramDiagnostic[]>([]);

  let inlineControls = $state<GraphControls | null>(null);
  let fullscreenControls = $state<GraphControls | null>(null);
  let inlineScale = $state(1);
  let fullscreenScale = $state(1);

  /**
   * Deliberately not reactive state: the graph writes it from its own layout
   * pass and it is only read while validating or exporting, so making it
   * reactive would re-render the diagram to no purpose.
   */
  let measurement: GraphMeasurement | null = null;
  let reportedSignature = '';

  const activeScale = $derived(isFullscreen ? fullscreenScale : inlineScale);
  const activeControls = $derived(isFullscreen ? fullscreenControls : inlineControls);
  const canZoomIn = $derived(activeScale < MAX_SCALE - 0.01);
  const canZoomOut = $derived(activeScale > MIN_SCALE + 0.01);

  const selectedNode = $derived(nodes.find((node) => node.id === selectedId) ?? null);
  const selectedMeta = $derived(
    selectedNode ? TYPE_META[(selectedNode.type ?? 'service') as NodeType] : null,
  );
  const selectedBoundaries = $derived(
    selectedNode
      ? boundaries.filter((boundary) => (boundary.wraps ?? []).includes(selectedNode.id))
      : [],
  );

  /** Distinct types present, so the legend describes this canvas only. */
  const legend = $derived.by(() => {
    const counts = new Map<NodeType, number>();
    for (const node of nodes) {
      const type = (node.type ?? 'service') as NodeType;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return [...counts].map(([type, count]) => ({ type, count, ...TYPE_META[type] }));
  });

  const hasErrors = $derived(diagnostics.some((diagnostic) => diagnostic.severity === 'error'));

  /**
   * Diagnostics are an authoring tool, so the badge and the panel stay out of
   * the published artifact. The gate is deliberately not `import.meta.env.DEV`
   * on its own: a dev server started from a shell that exports
   * NODE_ENV=production reports DEV as false, which would switch the tooling off
   * exactly when it is wanted. The query flag keeps a way in regardless.
   */
  const debugUi =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('diagram-debug'));

  function onMeasure(next: GraphMeasurement): void {
    measurement = next;

    const found = validateDiagram({
      nodes,
      connections,
      boundaries,
      boxes: next.boxes,
      authoredBoxes: next.authoredBoxes,
      // The geometry the reader is looking at, not a second guess at it.
      routed: next.edges,
      labels: next.labels,
      boundaryLabels: next.boundaryLabels,
      frame: next.frame,
    });
    diagnostics = found;

    // One report per distinct set of findings: the layout pass reruns on every
    // resize, and a console that repeats itself teaches nothing.
    const signature = found
      .map((diagnostic) => `${diagnostic.code}:${diagnostic.ids.join(',')}`)
      .sort()
      .join('|');
    if (signature === reportedSignature) return;
    reportedSignature = signature;
    if (found.length === 0) return;

    const totals = countBySeverity(found);
    console.warn(`[diagram] ${title} — ${totals.errors} error(s), ${totals.warnings} warning(s)`);
    for (const diagnostic of found) {
      console.warn(`  ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  function boundaryExport(boxes: Record<string, Box>) {
    const out: {
      id: string;
      label: string;
      kind: ArchBoundary['kind'];
      rect: NonNullable<ReturnType<typeof boundaryRect>>;
    }[] = [];

    for (const boundary of boundaries) {
      const members = (boundary.wraps ?? [])
        .map((id) => boxes[id])
        .filter((box): box is Box => Boolean(box));
      const rect = boundaryRect(members, boundary.pad);
      if (rect) out.push({ id: boundary.id, label: boundary.label, kind: boundary.kind, rect });
    }

    return out;
  }

  function buildExport(themes: DiagramTheme[]): string {
    const current = measurement;
    if (!current) throw new Error('The diagram has not finished laying out yet.');

    return buildDiagramSvg({
      title,
      description: `${nodes.length} component(s) and ${connections.length} relationship(s).`,
      nodes: nodes
        .map((node) => {
          const box = current.boxes[node.id];
          if (!box) return null;
          return {
            id: node.id,
            title: node.title,
            subtitle: node.subtitle,
            type: node.type,
            variant: nodeVariant(node),
            tone: TYPE_META[(node.type ?? 'service') as NodeType].tone,
            box,
          };
        })
        .filter((node): node is NonNullable<typeof node> => Boolean(node)),
      connections: current.edges,
      boundaries: boundaryExport(current.boxes),
      legend: legend.map((entry) => ({ label: entry.label, tone: entry.tone, count: entry.count })),
      themes,
    });
  }

  /** Every scheme at once for the file export; only the live one for a raster. */
  function activeThemes(themes: DiagramTheme[]): DiagramTheme[] {
    const active = themes.find((candidate) => candidate.scheme === theme.colorScheme);
    return active ? [active] : themes.slice(0, 1);
  }

  const exportItems: FrameExportItem[] = [
    {
      id: 'svg-both',
      label: 'Download SVG — both themes',
      run: () => {
        const name = svgFileName(title, 'svg');
        downloadSvgFile(buildExport(readDiagramThemes()), name);
        return `Saved ${name}`;
      },
    },
    {
      id: 'svg-current',
      label: 'Download SVG — this theme',
      run: () => {
        const name = svgFileName(title, 'svg');
        downloadSvgFile(buildExport(activeThemes(readDiagramThemes())), name);
        return `Saved ${name}`;
      },
    },
    {
      id: 'png',
      label: 'Download PNG',
      run: async () => {
        const name = svgFileName(title, 'png');
        await exportPngFile(buildExport(activeThemes(readDiagramThemes())), name);
        return `Saved ${name}`;
      },
    },
    {
      id: 'copy',
      label: 'Copy SVG source',
      run: async () =>
        (await copySvgText(buildExport(activeThemes(readDiagramThemes()))))
          ? 'SVG source copied'
          : 'The clipboard is unavailable',
    },
  ];
</script>

{#snippet actions()}
  <span class="arch-group">
    <button
      type="button"
      class="arch-btn"
      onclick={() => activeControls?.zoomIn()}
      disabled={!canZoomIn}
      aria-label="Zoom in"
      title="Zoom in"
    >
      <ZoomIn size={13} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="arch-btn"
      onclick={() => activeControls?.zoomOut()}
      disabled={!canZoomOut}
      aria-label="Zoom out"
      title="Zoom out"
    >
      <ZoomOut size={13} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="arch-btn"
      onclick={() => activeControls?.reset()}
      aria-label="Reset view"
      title="Reset view"
    >
      <RotateCcw size={13} aria-hidden="true" />
    </button>
  </span>

  {#if debugUi && diagnostics.length > 0}
    <button
      type="button"
      class="arch-btn is-flagged"
      class:is-active={showDiagnostics}
      aria-pressed={showDiagnostics}
      onclick={() => (showDiagnostics = !showDiagnostics)}
      title="Composition diagnostics (development only)"
      aria-label="Toggle composition diagnostics, {diagnostics.length} finding(s)"
    >
      {#if hasErrors}
        <TriangleAlert size={13} aria-hidden="true" />
      {:else}
        <Bug size={13} aria-hidden="true" />
      {/if}
      {diagnostics.length}
    </button>
  {/if}
{/snippet}

{#snippet footer()}
  <div class="arch-foot">
    <ul class="arch-legend">
      {#each legend as entry (entry.type)}
        {@const Icon = NODE_ICONS[entry.type]}
        <li class="arch-legend-item" data-tone={entry.tone}>
          <Icon size={11} aria-hidden="true" />
          {entry.label}
          <span class="arch-legend-count">{entry.count}</span>
        </li>
      {/each}

      {#each boundaries as boundary (boundary.id)}
        <li class="arch-legend-item is-boundary" data-kind={boundary.kind}>
          <span class="arch-legend-swatch" aria-hidden="true"></span>
          {BOUNDARY_META[boundary.kind]?.label ?? 'Boundary'}: {boundary.label}
        </li>
      {/each}
    </ul>

    {#if interactive}
      <p class="arch-hint">
        Select a node for detail · arrow keys move between nodes · scroll to zoom
      </p>
    {/if}
  </div>

  {#if debugUi && showDiagnostics}
    <div class="arch-diagnostics" role="region" aria-label="Composition diagnostics">
      {#if diagnostics.length === 0}
        <p class="arch-diagnostics-empty">No composition problems found.</p>
      {:else}
        <ul class="arch-diagnostics-list">
          {#each diagnostics as diagnostic, index (index)}
            <li data-severity={diagnostic.severity}>
              <code>{diagnostic.code}</code>
              <span>{diagnostic.message}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet fullscreenBody()}
  <div class="arch-fullscreen">
    <ArchitectureGraph
      {nodes}
      {connections}
      {boundaries}
      {interactive}
      bind:selectedId
      bind:controls={fullscreenControls}
      bind:scale={fullscreenScale}
    />
  </div>
{/snippet}

{#snippet fullscreenActions()}
  <span class="arch-group">
    <button
      type="button"
      class="arch-btn"
      onclick={() => fullscreenControls?.zoomIn()}
      disabled={!canZoomIn}
      aria-label="Zoom in"
    >
      <ZoomIn size={14} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="arch-btn"
      onclick={() => fullscreenControls?.zoomOut()}
      disabled={!canZoomOut}
      aria-label="Zoom out"
    >
      <ZoomOut size={14} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="arch-btn"
      onclick={() => fullscreenControls?.reset()}
      aria-label="Reset view"
    >
      <RotateCcw size={14} aria-hidden="true" />
    </button>
  </span>
{/snippet}

<figure class="arch" aria-label={title}>
  <DiagramFrame
    {title}
    {exportItems}
    {actions}
    {footer}
    fullscreen={interactive ? fullscreenBody : undefined}
    {fullscreenActions}
    bind:open={isFullscreen}
  >
    <ArchitectureGraph
      {nodes}
      {connections}
      {boundaries}
      {interactive}
      bind:selectedId
      bind:controls={inlineControls}
      bind:scale={inlineScale}
      {showDiagnostics}
      {diagnostics}
      onmeasure={onMeasure}
    />
  </DiagramFrame>

  {#if selectedNode && selectedMeta}
    <div class="arch-inspector" data-tone={selectedMeta.tone} role="region" aria-live="polite">
      <div class="arch-inspector-head">
        <span class="arch-inspector-title">{selectedNode.title}</span>
        <button
          type="button"
          class="arch-inspector-close"
          onclick={() => (selectedId = null)}
          aria-label="Close node detail"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      <dl class="arch-inspector-body">
        <dt>Type</dt>
        <dd>{selectedMeta.label}</dd>
        {#if selectedNode.subtitle}
          <dt>Detail</dt>
          <dd>{selectedNode.subtitle}</dd>
        {/if}
        <dt>Authored at</dt>
        <dd>{Math.round(selectedNode.x)}%, {Math.round(selectedNode.y)}%</dd>
        {#if selectedBoundaries.length > 0}
          <dt>Boundary</dt>
          <dd>{selectedBoundaries.map((boundary) => boundary.label).join(', ')}</dd>
        {/if}
      </dl>

      {#if selectedNode.tags?.length}
        <ul class="arch-tags">
          {#each selectedNode.tags as tag (tag)}
            <li class="arch-tag">{tag}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</figure>

<style>
  .arch {
    margin-block: 1.5rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-panel);
    overflow: hidden;
    background-color: var(--color-base-100);
  }

  .arch-group {
    display: inline-flex;
    gap: 0.1rem;
  }

  .arch-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem;
    border: 1px solid transparent;
    border-radius: var(--radius-chip);
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    cursor: pointer;
  }
  .arch-btn:hover:not(:disabled) {
    background-color: var(--color-base-300);
    color: var(--color-base-content);
  }
  .arch-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .arch-btn.is-flagged {
    color: var(--color-warning);
  }
  .arch-btn.is-flagged.is-active {
    border-color: var(--color-edge-strong);
    background-color: var(--color-base-300);
    color: var(--color-base-content);
  }

  .arch-fullscreen {
    height: 100%;
    /* Handed down to the graph, which sizes its own viewport from it. */
    --arch-viewport-height: 100%;
  }

  .arch-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
  }

  .arch-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .arch-legend-item {
    --tone: var(--color-neutral);

    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  }
  .arch-legend-item[data-tone='info'] {
    --tone: var(--color-info);
  }
  .arch-legend-item[data-tone='primary'] {
    --tone: var(--color-primary);
  }
  .arch-legend-item[data-tone='secondary'] {
    --tone: var(--color-secondary);
  }
  .arch-legend-item[data-tone='success'] {
    --tone: var(--color-success);
  }
  .arch-legend-item[data-tone='warning'] {
    --tone: var(--color-warning);
  }
  .arch-legend-item[data-tone='error'] {
    --tone: var(--color-error);
  }

  .arch-legend-item :global(svg) {
    color: var(--tone);
  }

  .arch-legend-count {
    font-family: var(--font-mono);
    color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
  }

  /* Boundaries are listed as shapes, not icons: a boundary is not a component
     type, and the legend has to say which claim it is making. */
  .arch-legend-item.is-boundary {
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }

  .arch-legend-swatch {
    width: 0.7rem;
    height: 0.7rem;
    border: 1px dashed var(--color-edge-strong);
    border-radius: 2px;
  }
  .arch-legend-item.is-boundary[data-kind='security-group'] .arch-legend-swatch {
    border-color: color-mix(in oklab, var(--color-error) 55%, var(--color-edge));
  }

  .arch-hint {
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
  }

  .arch-diagnostics {
    padding: 0.55rem 0.75rem;
    border-top: 1px solid var(--color-edge);
    background-color: color-mix(in oklab, var(--color-warning) 7%, var(--color-base-100));
  }

  .arch-diagnostics-empty {
    font-size: var(--text-micro);
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }

  .arch-diagnostics-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-micro);
  }

  .arch-diagnostics-list li {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    border-inline-start: 2px solid var(--color-warning);
    padding-inline-start: 0.4rem;
    color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
  }
  .arch-diagnostics-list li[data-severity='error'] {
    border-inline-start-color: var(--color-error);
  }

  .arch-diagnostics-list code {
    font-family: var(--font-mono);
    color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
  }

  .arch-inspector {
    --tone: var(--color-neutral);

    padding: 0.75rem 0.9rem;
    border-top: 1px solid var(--color-edge);
    border-inline-start: 3px solid var(--tone);
    background-color: color-mix(in oklab, var(--tone) 6%, var(--color-base-100));
  }

  .arch-inspector[data-tone='info'] {
    --tone: var(--color-info);
  }
  .arch-inspector[data-tone='primary'] {
    --tone: var(--color-primary);
  }
  .arch-inspector[data-tone='secondary'] {
    --tone: var(--color-secondary);
  }
  .arch-inspector[data-tone='success'] {
    --tone: var(--color-success);
  }
  .arch-inspector[data-tone='warning'] {
    --tone: var(--color-warning);
  }
  .arch-inspector[data-tone='error'] {
    --tone: var(--color-error);
  }

  .arch-inspector-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-bottom: 0.4rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid var(--color-edge);
  }

  .arch-inspector-title {
    font-size: var(--text-meta);
    font-weight: 640;
    color: var(--color-base-content);
  }

  .arch-inspector-close {
    display: grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-chip);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
    cursor: pointer;
  }
  .arch-inspector-close:hover {
    background-color: var(--color-base-200);
    color: var(--color-base-content);
  }

  .arch-inspector-body {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.15rem 0.75rem;
    margin: 0;
    font-size: var(--text-micro);
  }
  .arch-inspector-body dt {
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  }
  .arch-inspector-body dd {
    margin: 0;
    color: color-mix(in oklab, var(--color-base-content) 82%, transparent);
  }

  .arch-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
  }

  .arch-tag {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-chip);
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  }
</style>
