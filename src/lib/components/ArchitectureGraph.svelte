<script module lang="ts">
  /**
   * Deterministic instance numbering. Marker ids have to be namespaced per
   * canvas, and a random suffix would make the rendered output unstable
   * between renders of the same document.
   */
  let instanceSeq = 0;
</script>

<script lang="ts">
  /**
   * The canvas itself: measure, separate, fit, draw — and report what it saw.
   *
   * Split out of ArchitectureCanvas because the fullscreen view is a second,
   * independently sized copy of the same graph: the fit is relative to its own
   * viewport, so each instance measures and lays out for itself. The parent
   * owns the spec, the diagnostics and the exports; this component owns
   * geometry and interaction.
   *
   * Two coordinate spaces are in play. Authored `x`/`y` are percentages of the
   * canvas; everything after the fit is canvas px, which is what lets the edges
   * be drawn as ordinary SVG coordinates once the boxes are measured.
   */
  import { onMount } from 'svelte';
  import Panzoom, { type PanzoomObject } from '@panzoom/panzoom';

  import { NODE_ICONS } from '../diagram/icons';
  import {
    BOUNDARY_META,
    FIT_MAX_FILL,
    FIT_MAX_SCALE,
    FIT_PADDING_X,
    FIT_PADDING_Y,
    NODE_GAP,
    SEPARATION_PASSES,
    TYPE_META,
    type ArchBoundary,
    type ArchConnection,
    type ArchNode,
    type Box,
    type BoundaryKind,
    type DiagramDiagnostic,
    type NodeType,
    type Rect,
    type Tone,
    nodeVariant,
  } from '../diagram/types';
  import { boundaryRect, routeConnection, type Frame, type RoutedConnection } from '../diagram/geometry';

  export interface GraphControls {
    zoomIn: () => void;
    zoomOut: () => void;
    reset: () => void;
  }

  export interface GraphMeasurement {
    /** Boxes as rendered, after separation. */
    boxes: Record<string, Box>;
    /** Boxes at the authored coordinates, before separation. */
    authoredBoxes: Record<string, Box>;
    /** Routes as drawn, so the validator and the export never re-derive them. */
    edges: RoutedConnection[];
    /** Measured label rects, keyed by connection id. */
    labels: Record<string, Rect>;
    /** Measured boundary chips, keyed by boundary id. */
    boundaryLabels: Record<string, Rect>;
    frame: Frame;
  }

  interface Props {
    nodes: ArchNode[];
    connections?: ArchConnection[];
    boundaries?: ArchBoundary[];
    interactive?: boolean;
    /** Selection is shared, so the inline and fullscreen copies stay in step. */
    selectedId?: string | null;
    controls?: GraphControls | null;
    scale?: number;
    /** Dev-only: outline what the diagnostics point at. */
    showDiagnostics?: boolean;
    diagnostics?: DiagramDiagnostic[];
    /** Called once per layout, with everything the parent needs to validate or export. */
    onmeasure?: (measurement: GraphMeasurement) => void;
  }

  let {
    nodes = [],
    connections = [],
    boundaries = [],
    interactive = true,
    selectedId = $bindable<string | null>(null),
    controls = $bindable<GraphControls | null>(null),
    scale = $bindable(1),
    showDiagnostics = false,
    diagnostics = [],
    onmeasure,
  }: Props = $props();

  const uid = `arch-${(instanceSeq += 1)}`;

  let viewportEl = $state<HTMLDivElement | null>(null);
  let canvasEl = $state<HTMLDivElement | null>(null);
  let frameEl = $state<HTMLDivElement | null>(null);
  let panzoom: PanzoomObject | null = null;

  let frameSize = $state<Frame>({ width: 0, height: 0 });
  let boxes = $state<Record<string, Box>>({});
  let isLaidOut = $state(false);
  let fitTransform = $state('none');

  const edges = $derived.by((): RoutedConnection[] => {
    if (frameSize.width === 0 || frameSize.height === 0) return [];

    const out: RoutedConnection[] = [];
    for (const connection of connections) {
      const fromBox = boxes[connection.from];
      const toBox = boxes[connection.to];
      if (!fromBox || !toBox) continue;
      out.push(routeConnection(connection, fromBox, toBox, frameSize));
    }
    return out;
  });

  interface BoundaryView {
    id: string;
    kind: BoundaryKind;
    label: string;
    tone: Tone;
    rect: Rect;
  }

  const boundaryViews = $derived.by((): BoundaryView[] => {
    const out: BoundaryView[] = [];
    for (const boundary of boundaries) {
      const members = (boundary.wraps ?? [])
        .map((id) => boxes[id])
        .filter((box): box is Box => Boolean(box));
      const rect = boundaryRect(members, boundary.pad);
      if (!rect) continue;
      out.push({
        id: boundary.id,
        kind: boundary.kind,
        label: boundary.label,
        tone: BOUNDARY_META[boundary.kind]?.tone ?? 'neutral',
        rect,
      });
    }
    return out;
  });

  /** Dev-only overlay: what the diagnostics pointed at, on the canvas itself. */
  const flagged = $derived.by(() => {
    if (!showDiagnostics || diagnostics.length === 0) {
      return { nodes: [] as { id: string; box: Box }[], edges: [] as RoutedConnection[] };
    }
    const ids = new Set(diagnostics.flatMap((diagnostic) => diagnostic.ids));
    return {
      nodes: [...ids].filter((id) => boxes[id]).map((id) => ({ id, box: boxes[id] })),
      edges: edges.filter((edge) => ids.has(edge.id)),
    };
  });

  function typeOf(node: ArchNode) {
    return TYPE_META[(node.type ?? 'service') as NodeType] ?? TYPE_META.service;
  }

  /**
   * Placement in the authored space until the first measurement lands.
   *
   * The first render has no measured boxes, so a px position would collapse
   * every node onto the origin — and the fit would then measure that collapsed
   * layout. Percentages need no measurement at all, which is exactly what the
   * first pass needs; px takes over once the boxes exist, because routes have
   * to be computed in the same space the nodes are drawn in.
   */
  function positionStyle(node: ArchNode): string {
    const box = boxes[node.id];
    if (box) return `left: ${box.centreX}px; top: ${box.centreY}px;`;
    return `left: ${node.x}%; top: ${node.y}%;`;
  }

  function boxOf(node: ArchNode): { centreX: number; centreY: number } {
    const box = boxes[node.id];
    if (box) return { centreX: box.centreX, centreY: box.centreY };
    return {
      centreX: (node.x / 100) * frameSize.width,
      centreY: (node.y / 100) * frameSize.height,
    };
  }

  /**
   * Pushes overlapping boxes apart until every pair clears NODE_GAP.
   *
   * Authored coordinates are written by hand as rough percentages and know
   * nothing about how wide a node's title will render, so neighbouring boxes in
   * a row routinely end up touching — which makes the connections between them
   * invisible and leaves the edge labels nowhere to go. Each pair is separated
   * along whichever axis needs the smaller nudge, keeping the author's overall
   * arrangement intact.
   *
   * Authored boxes are measured before this runs, so the same drift can be
   * reported as a diagnostic rather than silently compensated.
   */
  function separate(items: Box[]): void {
    for (let pass = 0; pass < SEPARATION_PASSES; pass += 1) {
      let moved = false;

      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i];
          const b = items[j];

          const dx = b.centreX - a.centreX;
          const dy = b.centreY - a.centreY;
          const overlapX = a.halfWidth + b.halfWidth + NODE_GAP - Math.abs(dx);
          const overlapY = a.halfHeight + b.halfHeight + NODE_GAP - Math.abs(dy);

          if (overlapX <= 0 || overlapY <= 0) continue;
          moved = true;

          if (overlapX <= overlapY) {
            const shift = (overlapX / 2) * (dx < 0 ? -1 : 1);
            a.centreX -= shift;
            b.centreX += shift;
          } else {
            const shift = (overlapY / 2) * (dy < 0 ? -1 : 1);
            a.centreY -= shift;
            b.centreY += shift;
          }
        }
      }

      if (!moved) return;
    }
  }

  /** Layout values, so this stays stable under the frame's own transform. */
  function measureLabels(): Record<string, Rect> {
    const rects: Record<string, Rect> = {};
    if (!frameEl) return rects;

    for (const element of frameEl.querySelectorAll<HTMLElement>('[data-edge-label]')) {
      const id = element.dataset.edgeLabel;
      if (!id) continue;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const above = element.dataset.placement === 'above';
      rects[id] = {
        x: element.offsetLeft - width / 2,
        y: element.offsetTop - (above ? height : height / 2),
        width,
        height,
      };
    }

    return rects;
  }

  /**
   * Boundary chips, in frame coordinates. A chip is positioned inside its own
   * boundary box, so its offsets are relative to that box rather than the frame.
   */
  function measureBoundaryLabels(): Record<string, Rect> {
    const rects: Record<string, Rect> = {};
    if (!frameEl) return rects;

    for (const view of boundaryViews) {
      const chip = frameEl.querySelector<HTMLElement>(`[data-boundary-label="${CSS.escape(view.id)}"]`);
      if (!chip) continue;
      rects[view.id] = {
        x: view.rect.x + chip.offsetLeft,
        y: view.rect.y + chip.offsetTop,
        width: chip.offsetWidth,
        height: chip.offsetHeight,
      };
    }

    return rects;
  }

  /**
   * Turns the authored layout into a placed one: measure what the browser
   * actually rendered, separate any boxes that overlap, then scale and centre
   * the result to fill the viewport.
   *
   * Measuring beats deriving positions from the authored percentages, because
   * node boxes have real pixel sizes — fitting the centres alone pushes wide
   * nodes past the edge. `offsetLeft`/`offsetWidth` are layout values, so
   * measuring stays stable whatever transform is already applied.
   */
  function computeFit(): GraphMeasurement | null {
    const frame = frameEl;
    if (!frame) return null;

    const frameWidth = frame.clientWidth;
    const frameHeight = frame.clientHeight;
    const elements = [...frame.querySelectorAll<HTMLElement>('[data-node]')];
    if (frameWidth === 0 || frameHeight === 0 || elements.length === 0) return null;

    const items: Box[] = [];
    const authoredBoxes: Record<string, Box> = {};

    for (const element of elements) {
      const id = element.dataset.node;
      if (!id) continue;
      // Nodes are placed by centre (`left: x%` plus translate(-50%, -50%)),
      // and offsetLeft/offsetTop report layout rather than the rendered
      // transform — so the layout coordinate IS the centre.
      const box: Box = {
        centreX: element.offsetLeft,
        centreY: element.offsetTop,
        halfWidth: element.offsetWidth / 2,
        halfHeight: element.offsetHeight / 2,
      };
      items.push({ ...box });
      authoredBoxes[id] = box;
    }
    if (items.length === 0) return null;

    separate(items);

    const nextBoxes: Record<string, Box> = {};
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // `items` keeps measurement order, so the nth measured element owns the nth
    // box.
    for (const [index, element] of elements.entries()) {
      const id = element.dataset.node;
      if (!id) continue;
      const item = items[index];

      nextBoxes[id] = item;
      minX = Math.min(minX, item.centreX - item.halfWidth);
      maxX = Math.max(maxX, item.centreX + item.halfWidth);
      minY = Math.min(minY, item.centreY - item.halfHeight);
      maxY = Math.max(maxY, item.centreY + item.halfHeight);
    }

    // Boundaries are part of the composition, not decoration around it: if the
    // fit only measured node boxes, a boundary's top band would be cropped off
    // the edge of the canvas.
    for (const boundary of boundaries) {
      const members = (boundary.wraps ?? [])
        .map((id) => nextBoxes[id])
        .filter((box): box is Box => Boolean(box));
      const rect = boundaryRect(members, boundary.pad);
      if (!rect) continue;
      minX = Math.min(minX, rect.x);
      maxX = Math.max(maxX, rect.x + rect.width);
      minY = Math.min(minY, rect.y);
      maxY = Math.max(maxY, rect.y + rect.height);
    }

    boxes = nextBoxes;
    frameSize = { width: frameWidth, height: frameHeight };

    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);

    // Two clamps: a minimum margin in px, and a maximum share of the viewport.
    // Both exist so the fitted content never butts against the frame and always
    // leaves somewhere to pan into.
    const maxWidth = Math.min(frameWidth - FIT_PADDING_X * 2, frameWidth * FIT_MAX_FILL);
    const maxHeight = Math.min(frameHeight - FIT_PADDING_Y * 2, frameHeight * FIT_MAX_FILL);
    const fitScale = Math.min(maxWidth / spanX, maxHeight / spanY, FIT_MAX_SCALE);

    // Centre the scaled bounding box, then shift the box's own origin to 0.
    const translateX = (frameWidth - spanX * fitScale) / 2 - minX * fitScale;
    const translateY = (frameHeight - spanY * fitScale) / 2 - minY * fitScale;

    fitTransform = `translate(${translateX}px, ${translateY}px) scale(${fitScale})`;
    isLaidOut = true;

    return {
      boxes: nextBoxes,
      authoredBoxes,
      edges: [],
      labels: {},
      boundaryLabels: {},
      frame: { width: frameWidth, height: frameHeight },
    };
  }

  export function focusNode(id: string): void {
    canvasEl?.querySelector<HTMLButtonElement>(`[data-node="${CSS.escape(id)}"]`)?.focus();
  }

  /**
   * Arrow keys move to the nearest node in that direction — on a 2D canvas,
   * tab order alone does not convey position.
   */
  function onNodeKeydown(event: KeyboardEvent, node: ArchNode) {
    const offsets: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowDown: [0, 1],
      ArrowUp: [0, -1],
    };
    const direction = offsets[event.key];
    if (!direction) return;

    event.preventDefault();
    if (frameSize.width === 0 || frameSize.height === 0) return;

    const from = boxOf(node);
    const [dx, dy] = direction;

    let best: ArchNode | null = null;
    let bestScore = Infinity;
    for (const candidate of nodes) {
      if (candidate.id === node.id) continue;
      const at = boxOf(candidate);
      const relX = (at.centreX - from.centreX) / frameSize.width;
      const relY = (at.centreY - from.centreY) / frameSize.height;
      const along = relX * dx + relY * dy;
      if (along <= 0.01) continue; // not in that direction
      const across = Math.abs(relX * dy - relY * dx);
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) focusNode(best.id);
  }

  onMount(() => {
    if (!canvasEl || !interactive) return;

    panzoom = Panzoom(canvasEl, {
      maxScale: 3,
      minScale: 0.5,
      contain: 'outside',
      cursor: 'grab',
    });

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      panzoom?.zoomWithWheel(event);
      scale = panzoom?.getScale() ?? 1;
    };
    viewportEl?.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      viewportEl?.removeEventListener('wheel', onWheel);
      panzoom?.destroy();
      panzoom = null;
    };
  });

  $effect(() => {
    controls = {
      zoomIn: () => {
        panzoom?.zoomIn();
        scale = panzoom?.getScale() ?? 1;
      },
      zoomOut: () => {
        panzoom?.zoomOut();
        scale = panzoom?.getScale() ?? 1;
      },
      reset: () => {
        panzoom?.reset();
        scale = panzoom?.getScale() ?? 1;
        selectedId = null;
      },
    };

    return () => {
      controls = null;
    };
  });

  // Fit once the nodes are laid out, whenever the layout data changes, and on
  // every container resize. Deferred a frame so node boxes have their real size.
  $effect(() => {
    void nodes;
    const viewport = viewportEl;
    if (!viewport) return;

    let fitFrame = 0;
    let labelFrame = 0;

    const report = (measurement: GraphMeasurement) => {
      // Labels move with the routes they belong to, which land in the DOM one
      // flush after the fit.
      labelFrame = requestAnimationFrame(() => {
        labelFrame = 0;
        onmeasure?.({
          ...measurement,
          edges,
          labels: measureLabels(),
          boundaryLabels: measureBoundaryLabels(),
        });
      });
    };

    const schedule = () => {
      if (fitFrame) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0;
        const measurement = computeFit();
        if (measurement) report(measurement);
      });
    };

    schedule();

    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);

    return () => {
      if (fitFrame) cancelAnimationFrame(fitFrame);
      if (labelFrame) cancelAnimationFrame(labelFrame);
      observer.disconnect();
    };
  });
</script>

<div class="arch-viewport dot-grid-bg" bind:this={viewportEl}>
  <div class="arch-canvas" bind:this={canvasEl}>
    <!-- Everything lives in the frame; the fit scales and centres it so the
         authored coordinates fill the viewport instead of leaving a band of
         empty canvas under the title. -->
    <div
      class="arch-frame"
      class:is-laid-out={isLaidOut}
      bind:this={frameEl}
      style="transform: {fitTransform}"
    >
      {#each boundaryViews as boundary (boundary.id)}
        <!-- A boundary is a claim about ownership or trust. The box is
             decorative; its label is repeated in the legend so the claim is
             never carried by colour alone. -->
        <div
          class="arch-boundary"
          data-kind={boundary.kind}
          data-boundary={boundary.id}
          style="left: {boundary.rect.x}px; top: {boundary.rect.y}px; width: {boundary.rect.width}px; height: {boundary.rect.height}px;"
          aria-hidden="true"
        >
          <span class="arch-boundary-label" data-boundary-label={boundary.id}>{boundary.label}</span>
        </div>
      {/each}

      <svg class="arch-edges" aria-hidden="true">
        <defs>
          <!-- Namespaced per instance: a shared id would collide when two
               canvases share a page. -->
          <marker id="{uid}-arrow-end" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="context-stroke" />
          </marker>
          <marker id="{uid}-arrow-start" markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto">
            <polygon points="7 0, 0 3.5, 7 7" fill="context-stroke" />
          </marker>
        </defs>

        {#each edges as edge (edge.id)}
          <path
            d={edge.d}
            fill="none"
            stroke={edge.color ?? 'var(--color-edge-strong)'}
            stroke-width={edge.variant === 'emphasis' ? edge.width * 1.6 : edge.width}
            stroke-dasharray={edge.variant === 'dashed' ? '5 5' : 'none'}
            data-variant={edge.variant}
            marker-end="url(#{uid}-arrow-end)"
            marker-start={edge.bidirectional ? `url(#${uid}-arrow-start)` : undefined}
          />
        {/each}
      </svg>

      {#each edges as edge (edge.id)}
        {#if edge.label}
          <!-- Rendered on the canvas rather than dropped: the label is part of
               the relationship, not decoration. -->
          <span
            class="arch-edge-label"
            data-edge-label={edge.id}
            data-placement={edge.labelPlacement}
            data-variant={edge.variant}
            style="left: {edge.labelPoint.x}px; top: {edge.labelPoint.y}px;"
          >
            {edge.label}
          </span>
        {/if}
      {/each}

      {#each nodes as node (node.id)}
        {@const view = typeOf(node)}
        {@const Icon = NODE_ICONS[(node.type ?? 'service') as NodeType]}
        <button
          type="button"
          class="arch-node"
          class:is-selected={selectedId === node.id}
          data-tone={view.tone}
          data-variant={nodeVariant(node)}
          data-node={node.id}
          style={positionStyle(node)}
          aria-pressed={selectedId === node.id}
          onclick={() => (selectedId = selectedId === node.id ? null : node.id)}
          onkeydown={(event) => onNodeKeydown(event, node)}
        >
          <span class="arch-node-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
          <span class="arch-node-text">
            <span class="arch-node-title">{node.title}</span>
            {#if node.subtitle}
              <span class="arch-node-subtitle">{node.subtitle}</span>
            {/if}
          </span>
        </button>
      {/each}

      {#if showDiagnostics && (flagged.nodes.length > 0 || flagged.edges.length > 0)}
        <svg class="arch-overlay" aria-hidden="true">
          {#each flagged.edges as edge, index (index)}
            <path d={edge.d} fill="none" stroke="var(--color-error)" stroke-width="3" stroke-dasharray="3 3" />
          {/each}
        </svg>
        {#each flagged.nodes as node (node.id)}
          <span
            class="arch-diag-node"
            style="left: {node.box.centreX - node.box.halfWidth}px; top: {node.box.centreY - node.box.halfHeight}px; width: {node.box.halfWidth * 2}px; height: {node.box.halfHeight * 2}px;"
          ></span>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .arch-viewport {
    position: relative;
    /* Deliberately wider than it is tall: architecture layouts run left to
       right, so a tall box would only ever be fitted to its width. It carries
       room for two node rows plus their boundary bands, and the fullscreen view
       lifts this to the dialog's height. */
    height: var(--arch-viewport-height, 15rem);
    overflow: hidden;
    background-color: var(--color-base-100);
    touch-action: none;
  }

  .arch-canvas {
    position: relative;
    width: 100%;
    height: 100%;
    /* A floor so a sparse layout is not squeezed sideways in the document
       column — but never wider than the box it is in, which would push the
       fitted content off-centre in the fullscreen view. */
    min-width: min(620px, 100%);
    user-select: none;
  }

  /* The fitted layer. Origin at 0 0 so the fit can place it with a plain
     translate + scale. Hidden until the first fit lands, otherwise the raw
     authored layout would flash before being scaled. */
  .arch-frame {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
    opacity: 0;
  }
  .arch-frame.is-laid-out {
    opacity: 1;
    transition: opacity 180ms ease-out;
  }

  .arch-boundary {
    position: absolute;
    z-index: 0;
    border: 1px dashed var(--color-edge-strong);
    border-radius: var(--radius-panel);
    background-color: color-mix(in oklab, var(--color-base-content) 3%, transparent);
  }
  .arch-boundary[data-kind='security-group'] {
    border-color: color-mix(in oklab, var(--color-error) 55%, var(--color-edge));
    background-color: color-mix(in oklab, var(--color-error) 4%, transparent);
  }

  .arch-boundary-label {
    position: absolute;
    top: 0.15rem;
    left: 0.4rem;
    padding: 0 0.25rem;
    font-family: var(--font-mono);
    font-size: var(--text-micro);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
  }
  .arch-boundary[data-kind='security-group'] .arch-boundary-label {
    color: color-mix(in oklab, var(--color-error) 75%, var(--color-base-content));
  }

  .arch-edges {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .arch-edge-label {
    position: absolute;
    /* Above the nodes: a route often passes underneath a node box, and a
       dropped label is worse than one crossing a node. */
    z-index: 20;
    transform: translate(-50%, -50%);
    padding: 0 0.3rem;
    border-radius: var(--radius-chip);
    background-color: var(--color-base-100);
    border: 1px solid var(--color-edge);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    line-height: 1.6;
    white-space: nowrap;
    color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  }
  .arch-edge-label[data-variant='emphasis'] {
    border-color: color-mix(in oklab, var(--color-primary) 45%, var(--color-edge));
    color: color-mix(in oklab, var(--color-base-content) 78%, transparent);
  }

  /* Anchored by its bottom edge, so the label's own height cannot reach back
     down into the node row it was lifted clear of. */
  .arch-edge-label[data-placement='above'] {
    transform: translate(-50%, -100%);
  }

  .arch-node {
    --node-tone: var(--color-neutral);

    position: absolute;
    z-index: 10;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--color-edge);
    border-inline-start: 3px solid var(--node-tone);
    border-radius: var(--radius-edge);
    background-color: var(--color-base-100);
    text-align: start;
    cursor: pointer;
    /* Shrink-to-fit would clamp the node to the space left of the canvas edge,
       squashing labels into a narrow column. The cap keeps a long subtitle from
       widening the box enough to crowd its neighbours. */
    width: max-content;
    max-width: 13.5rem;
    transition:
      border-color 120ms ease-out,
      background-color 120ms ease-out;
  }
  .arch-node:hover {
    border-color: var(--color-edge-strong);
    background-color: var(--color-base-200);
  }
  .arch-node[data-variant='emphasis'] {
    border-color: color-mix(in oklab, var(--color-primary) 50%, var(--color-edge));
  }
  .arch-node[data-variant='dashed'] {
    border-block-style: dashed;
  }
  .arch-node[data-variant='security'] {
    border-block-style: dashed;
    border-color: color-mix(in oklab, var(--color-error) 55%, var(--color-edge));
  }
  .arch-node.is-selected {
    border-color: var(--color-primary);
    background-color: color-mix(in oklab, var(--color-primary) 8%, var(--color-base-100));
  }

  .arch-node[data-tone='info'] {
    --node-tone: var(--color-info);
  }
  .arch-node[data-tone='primary'] {
    --node-tone: var(--color-primary);
  }
  .arch-node[data-tone='secondary'] {
    --node-tone: var(--color-secondary);
  }
  .arch-node[data-tone='success'] {
    --node-tone: var(--color-success);
  }
  .arch-node[data-tone='warning'] {
    --node-tone: var(--color-warning);
  }
  .arch-node[data-tone='error'] {
    --node-tone: var(--color-error);
  }

  .arch-node-icon {
    display: grid;
    place-items: center;
    width: 1.65rem;
    height: 1.65rem;
    flex-shrink: 0;
    border-radius: var(--radius-chip);
    background-color: color-mix(in oklab, var(--node-tone) 12%, transparent);
    color: var(--node-tone);
  }

  .arch-node-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .arch-node-title {
    font-size: var(--text-meta);
    font-weight: 620;
    color: var(--color-base-content);
    line-height: 1.3;
  }

  .arch-node-subtitle {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  }

  .arch-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 30;
    overflow: visible;
    pointer-events: none;
  }

  .arch-diag-node {
    position: absolute;
    z-index: 31;
    border: 1px dashed var(--color-error);
    border-radius: var(--radius-edge);
    pointer-events: none;
  }
</style>
