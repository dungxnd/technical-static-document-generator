/**
 * Composition diagnostics.
 *
 * The model is authored, not solved, so these checks are the safety net a
 * solver would otherwise provide: they run over the same geometry the renderer
 * draws. Structural problems are errors; composition problems are warnings —
 * a route crossing a box only matters if the reader cannot follow the diagram.
 *
 * Authoring invariants worth knowing while reading a report:
 *   - one obvious main path, and a side branch leaves the nearest main-path node;
 *   - relationship labels are semantic data: reposition or shorten one, never
 *     delete it to clear a collision;
 *   - spacing means clear gap, not centre distance.
 */

import {
  ID_PATTERN,
  NODE_GAP,
  connectionId,
  type ArchBoundary,
  type ArchConnection,
  type ArchNode,
  type Box,
  type DiagramDiagnostic,
  type Rect,
} from './types';
import {
  boundaryRect,
  polylineIntersectsRect,
  rectContainsPoint,
  rectOfBox,
  rectsOverlap,
  routeConnection,
  type Frame,
  type RoutedConnection,
} from './geometry';

export interface ValidateInput {
  nodes: ArchNode[];
  connections?: ArchConnection[];
  boundaries?: ArchBoundary[];
  /**
   * Boxes as rendered, keyed by node id. Without them the composition checks
   * are skipped rather than guessed — only the browser knows how wide a given
   * title actually rendered.
   */
  boxes?: Record<string, Box>;
  /** Measured boxes at the authored coordinates, for the overlap check. */
  authoredBoxes?: Record<string, Box>;
  /**
   * Routes the renderer already drew. Passing them keeps validation free of the
   * work it would otherwise duplicate — the checks and the canvas must agree on
   * the geometry, and the cheapest way to guarantee that is to share it.
   */
  routed?: RoutedConnection[];
  /** Measured label rects, keyed by connection id. */
  labels?: Record<string, Rect>;
  /** Measured boundary chips, keyed by boundary id. */
  boundaryLabels?: Record<string, Rect>;
  frame?: Frame;
}

export function validateDiagram(input: ValidateInput): DiagramDiagnostic[] {
  const out: DiagramDiagnostic[] = [];
  const push = (diagnostic: DiagramDiagnostic) => out.push(diagnostic);

  const connections = input.connections ?? [];
  const boundaries = input.boundaries ?? [];
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  const known = (id: string) => nodeIds.has(id);

  checkNodes(input.nodes, push);
  checkConnections(input.nodes, connections, known, push);
  checkBoundaries(boundaries, known, push);
  checkReachability(input.nodes, connections, push);

  const boxes = input.boxes;
  const frame = input.frame;
  if (boxes && frame && frame.width > 0 && frame.height > 0) {
    checkOverlap(input.nodes, input.authoredBoxes ?? boxes, push);
    checkRoutes(input.nodes, connections, boxes, frame, input.boundaryLabels, input.routed, push);
    checkLabels(input.nodes, connections, boxes, input.labels, push);
    checkBoundaryMembership(input.nodes, boundaries, boxes, push);
    checkBoundaryLabelCollisions(input.labels, input.boundaryLabels, push);
  }

  return out;
}

function checkNodes(nodes: ArchNode[], push: (diagnostic: DiagramDiagnostic) => void): void {
  const seen = new Set<string>();

  for (const node of nodes) {
    if (seen.has(node.id)) {
      push({
        code: 'duplicate-node-id',
        severity: 'error',
        message: `Two nodes share the id "${node.id}".`,
        ids: [node.id],
      });
    }
    seen.add(node.id);

    if (!ID_PATTERN.test(node.id)) {
      push({
        code: 'id-convention',
        severity: 'warning',
        message: `Node id "${node.id}" is not address-like — prefer letters, digits, "_" and "-".`,
        ids: [node.id],
      });
    }

    if (!node.title?.trim()) {
      push({
        code: 'empty-node-title',
        severity: 'error',
        message: `Node "${node.id}" has no title.`,
        ids: [node.id],
      });
    }

    if (!isPercent(node.x) || !isPercent(node.y)) {
      push({
        code: 'out-of-range-coordinate',
        severity: 'error',
        message: `Node "${node.id}" is placed at ${node.x}%, ${node.y}% — coordinates are canvas percentages (0-100).`,
        ids: [node.id],
      });
    }
  }
}

function isPercent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function checkConnections(
  nodes: ArchNode[],
  connections: ArchConnection[],
  known: (id: string) => boolean,
  push: (diagnostic: DiagramDiagnostic) => void,
): void {
  const titles = new Map(nodes.map((node) => [node.id, node.title]));
  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();

  for (const connection of connections) {
    const id = connectionId(connection);

    if (seenIds.has(id)) {
      push({
        code: 'duplicate-connection-id',
        severity: 'error',
        message: `Two connections resolve to the id "${id}" — give one of them an explicit id.`,
        ids: [id],
      });
    }
    seenIds.add(id);

    const pair = `${connection.from}->${connection.to}`;
    if (seenPairs.has(pair)) {
      push({
        code: 'duplicate-connection',
        severity: 'warning',
        message: `"${pair}" is declared twice — merge them, or give them distinct labels.`,
        ids: [id],
      });
    }
    seenPairs.add(pair);

    if (!known(connection.from) || !known(connection.to)) {
      const missing = [connection.from, connection.to].filter((end) => !known(end));
      push({
        code: 'unknown-endpoint',
        severity: 'error',
        message: `Connection "${id}" points at ${missing.map((end) => `"${end}"`).join(' and ')}, which no node declares.`,
        ids: [id],
      });
      continue;
    }

    if (connection.from === connection.to) {
      push({
        code: 'self-connection',
        severity: 'error',
        message: `Connection "${id}" joins "${connection.from}" to itself.`,
        ids: [id],
      });
    }

    const label = connection.label?.trim().toLowerCase();
    if (label) {
      for (const end of [connection.from, connection.to]) {
        if (titles.get(end)?.trim().toLowerCase() === label) {
          push({
            code: 'label-redundant',
            severity: 'warning',
            message: `Label "${connection.label}" on "${id}" restates "${end}" — the endpoints already say it.`,
            ids: [id, end],
          });
        }
      }
    }
  }
}

function checkBoundaries(
  boundaries: ArchBoundary[],
  known: (id: string) => boolean,
  push: (diagnostic: DiagramDiagnostic) => void,
): void {
  const seen = new Set<string>();

  for (const boundary of boundaries) {
    if (seen.has(boundary.id)) {
      push({
        code: 'duplicate-boundary-id',
        severity: 'error',
        message: `Two boundaries share the id "${boundary.id}".`,
        ids: [boundary.id],
      });
    }
    seen.add(boundary.id);

    if (!boundary.label?.trim()) {
      push({
        code: 'empty-boundary-label',
        severity: 'error',
        message: `Boundary "${boundary.id}" has no label — a boundary is a claim about ownership or trust, so it needs wording.`,
        ids: [boundary.id],
      });
    }

    const members = boundary.wraps ?? [];
    if (members.length === 0) {
      push({
        code: 'empty-boundary',
        severity: 'error',
        message: `Boundary "${boundary.id}" wraps nothing.`,
        ids: [boundary.id],
      });
    }

    const seenMembers = new Set<string>();
    for (const member of members) {
      if (!known(member)) {
        push({
          code: 'unknown-boundary-member',
          severity: 'error',
          message: `Boundary "${boundary.id}" wraps "${member}", which no node declares.`,
          ids: [boundary.id, member],
        });
      }
      if (seenMembers.has(member)) {
        push({
          code: 'duplicate-boundary-member',
          severity: 'warning',
          message: `Boundary "${boundary.id}" lists "${member}" twice.`,
          ids: [boundary.id, member],
        });
      }
      seenMembers.add(member);
    }
  }
}

function checkReachability(
  nodes: ArchNode[],
  connections: ArchConnection[],
  push: (diagnostic: DiagramDiagnostic) => void,
): void {
  const touched = new Set<string>();
  for (const connection of connections) {
    touched.add(connection.from);
    touched.add(connection.to);
  }

  for (const node of nodes) {
    if (touched.has(node.id)) continue;
    push({
      code: 'unreachable-node',
      severity: 'warning',
      message: `"${node.id}" has no connections — an isolated box is either decoration or a missing relationship.`,
      ids: [node.id],
    });
  }
}

/** Authored clear gap, not centre distance: two boxes need NODE_GAP of air. */
function checkOverlap(
  nodes: ArchNode[],
  boxes: Record<string, Box>,
  push: (diagnostic: DiagramDiagnostic) => void,
): void {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = boxes[nodes[i].id];
      const b = boxes[nodes[j].id];
      if (!a || !b) continue;

      const clearX = Math.abs(b.centreX - a.centreX) - (a.halfWidth + b.halfWidth);
      const clearY = Math.abs(b.centreY - a.centreY) - (a.halfHeight + b.halfHeight);
      if (clearX >= NODE_GAP || clearY >= NODE_GAP) continue;

      push({
        code: 'overlapping-nodes',
        severity: 'warning',
        message: `"${nodes[i].id}" and "${nodes[j].id}" keep only ${Math.max(clearX, clearY).toFixed(0)}px of clear gap, under the ${NODE_GAP}px the layout is tuned for.`,
        ids: [nodes[i].id, nodes[j].id],
      });
    }
  }
}

function checkRoutes(
  nodes: ArchNode[],
  connections: ArchConnection[],
  boxes: Record<string, Box>,
  frame: Frame,
  boundaryLabels: Record<string, Rect> | undefined,
  routed: RoutedConnection[] | undefined,
  push: (diagnostic: DiagramDiagnostic) => void,
): void {
  const drawn =
    routed ??
    connections.flatMap((connection) => {
      const fromBox = boxes[connection.from];
      const toBox = boxes[connection.to];
      if (!fromBox || !toBox) return [];
      return [routeConnection(connection, fromBox, toBox, frame)];
    });

  for (const route of drawn) {
    for (const node of nodes) {
      if (node.id === route.from || node.id === route.to) continue;
      const box = boxes[node.id];
      if (!box) continue;

      if (polylineIntersectsRect(route.points, rectOfBox(box))) {
        push({
          code: 'edge-crosses-node',
          severity: 'warning',
          message: `"${route.id}" runs through "${node.id}" — give the route a clear corridor, or author fromSide/toSide or via to steer it.`,
          ids: [route.id, node.id],
        });
      }
    }

    for (const [boundaryId, chipRect] of Object.entries(boundaryLabels ?? {})) {
      if (!polylineIntersectsRect(route.points, chipRect, 0)) continue;
      push({
        code: 'route-crosses-boundary-label',
        severity: 'warning',
        message: `"${route.id}" runs through the "${boundaryId}" boundary label — steer the route with via, or move the boundary's own wording.`,
        ids: [route.id, boundaryId],
      });
    }
  }
}

function checkLabels(
  nodes: ArchNode[],
  connections: ArchConnection[],
  boxes: Record<string, Box>,
  labels: Record<string, Rect> | undefined,
  push: (diagnostic: DiagramDiagnostic) => void,
): void {
  if (!labels) return;

  const byId = new Map(connections.map((connection) => [connectionId(connection), connection]));

  for (const [id, rect] of Object.entries(labels)) {
    const connection = byId.get(id);
    if (!connection) continue;

    for (const node of nodes) {
      if (node.id === connection.from || node.id === connection.to) continue;
      const box = boxes[node.id];
      if (!box) continue;

      if (rectsOverlap(rect, rectOfBox(box))) {
        push({
          code: 'label-masks-node',
          severity: 'warning',
          message: `The label on "${id}" covers "${node.id}" — move it with labelAt, labelDx/labelDy or labelSegment.`,
          ids: [id, node.id],
        });
      }
    }
  }
}

/** A boundary claims a set of nodes; a node inside it that it does not wrap is a contradiction. */
function checkBoundaryMembership(
  nodes: ArchNode[],
  boundaries: ArchBoundary[],
  boxes: Record<string, Box>,
  push: (diagnostic: DiagramDiagnostic) => void,
): void {
  for (const boundary of boundaries) {
    const members = (boundary.wraps ?? [])
      .map((id) => boxes[id])
      .filter((box): box is Box => Boolean(box));
    const rect = boundaryRect(members, boundary.pad);
    if (!rect) continue;

    const wrapped = new Set(boundary.wraps ?? []);
    for (const node of nodes) {
      if (wrapped.has(node.id)) continue;
      const box = boxes[node.id];
      if (!box) continue;

      if (rectContainsPoint(rect, { x: box.centreX, y: box.centreY })) {
        push({
          code: 'boundary-encloses-outsider',
          severity: 'warning',
          message: `Boundary "${boundary.id}" encloses "${node.id}", which it does not wrap — add it to wraps, or move it out.`,
          ids: [boundary.id, node.id],
        });
      }
    }
  }
}

/**
 * A relationship label and a boundary's own label are both wording the reader
 * has to read; one covering the other is a composition failure, not a taste
 * call. The renderer keeps them in separate lanes, so this fires only when an
 * authored placement (labelAt / labelDx / labelDy) reaches into the other lane.
 */
function checkBoundaryLabelCollisions(
  labels: Record<string, Rect> | undefined,
  boundaryLabels: Record<string, Rect> | undefined,
  push: (diagnostic: DiagramDiagnostic) => void,
): void {
  if (!labels || !boundaryLabels) return;

  for (const [connectionId, labelRect] of Object.entries(labels)) {
    for (const [boundaryId, chipRect] of Object.entries(boundaryLabels)) {
      if (!rectsOverlap(labelRect, chipRect)) continue;
      push({
        code: 'boundary-label-collision',
        severity: 'warning',
        message: `The label on "${connectionId}" covers the "${boundaryId}" boundary label — move it with labelAt, labelDx or labelDy.`,
        ids: [connectionId, boundaryId],
      });
    }
  }
}

export function countBySeverity(diagnostics: DiagramDiagnostic[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}
