/**
 * Diagram geometry.
 *
 * Pure canvas-px math shared by the renderer and the validator: nothing here
 * touches the DOM, so the checks run over the same routes the user sees.
 *
 * Routes are authored, not solved. Sides and waypoints are contracts the
 * renderer must honour, and a route that would cross an unrelated box is
 * reported by the validator rather than silently re-routed — hand-tuned
 * layouts stay hand-tuned.
 */

import {
  BOUNDARY_PAD,
  BOUNDARY_TOP_INSET,
  ROUTE_STUB,
  type ArchConnection,
  type Box,
  type ConnectionVariant,
  type Point,
  type Rect,
  type RouteMode,
  type Side,
  connectionId,
  connectionVariant,
  connectionWidth,
} from './types';

export interface Frame {
  width: number;
  height: number;
}

export interface RoutedConnection {
  id: string;
  from: string;
  to: string;
  /** The drawn polyline, in canvas px. */
  points: Point[];
  /** `points` as an SVG path. */
  d: string;
  label: string;
  labelPoint: Point;
  labelPlacement: 'above' | 'middle';
  variant: ConnectionVariant;
  bidirectional: boolean;
  /** Authored colour override, or null to use the edge token. */
  color: string | null;
  width: number;
}

const HORIZONTAL_SIDES: Side[] = ['left', 'right'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function rectOfBox(box: Box): Rect {
  return {
    x: box.centreX - box.halfWidth,
    y: box.centreY - box.halfHeight,
    width: box.halfWidth * 2,
    height: box.halfHeight * 2,
  };
}

export function expandRect(rect: Rect, pad: number): Rect {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectContainsPoint(rect: Rect, point: Point, inset = 0): boolean {
  return (
    point.x >= rect.x + inset &&
    point.x <= rect.x + rect.width - inset &&
    point.y >= rect.y + inset &&
    point.y <= rect.y + rect.height - inset
  );
}

/**
 * The box a boundary wraps: the union of its members, plus clear space.
 *
 * The top edge is the exception — it is derived, never authored, because the
 * boundary's own label and any relationship label lifted clear of the first row
 * would otherwise compete for the same band. A `pad` larger than the derived
 * inset still wins, since a boundary may legitimately want more room than the
 * two labels need.
 */
export function boundaryRect(members: Box[], pad = BOUNDARY_PAD): Rect | null {
  const union = unionRects(members.map(rectOfBox));
  if (!union) return null;

  const rect = expandRect(union, pad);
  const topInset = Math.max(pad, BOUNDARY_TOP_INSET);
  return {
    x: rect.x,
    y: rect.y + pad - topInset,
    width: rect.width,
    height: rect.height + (topInset - pad),
  };
}

export function pointsEqual(a: Point, b: Point, epsilon = 0.01): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

export function dedupePoints(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    if (out.length === 0 || !pointsEqual(out[out.length - 1], point)) out.push(point);
  }
  return out;
}

/**
 * Drops points that only continue the current run.
 *
 * An orthogonal route between two boxes on the same axis is geometrically a
 * straight line, but its elbow construction produces several collinear points.
 * Collapsing them keeps the path honest — and lets the label logic see the
 * straight run it actually is, rather than counting corners that are not there.
 */
export function simplifyPoints(points: Point[]): Point[] {
  const out: Point[] = [];

  for (const point of points) {
    out.push(point);

    while (out.length >= 3) {
      const a = out[out.length - 3];
      const b = out[out.length - 2];
      const c = out[out.length - 1];

      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const doublesBack = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) <= 0;
      if (Math.abs(cross) > 0.01 || doublesBack) break;

      out.splice(out.length - 2, 1);
    }
  }

  return out;
}

export function pathFromPoints(points: Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`)
    .join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Sides a route would take if the spec did not author any. */
export function autoSides(from: Box, to: Box): { from: Side; to: Side } {
  const dx = to.centreX - from.centreX;
  const dy = to.centreY - from.centreY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

/**
 * Where a route touches a box.
 *
 * The port slides along its side toward the other end so two routes sharing a
 * side do not stack on the same point — the shared-corridor ambiguity. It never
 * leaves the middle stretch of the side, which keeps a corner clear for a
 * second route to use.
 */
export function sideAnchor(box: Box, side: Side, towards: Point): Point {
  const SLIDE = 0.32;
  const LIMIT = 0.62;
  switch (side) {
    case 'left':
      return {
        x: box.centreX - box.halfWidth,
        y: box.centreY + clamp((towards.y - box.centreY) * SLIDE, -box.halfHeight * LIMIT, box.halfHeight * LIMIT),
      };
    case 'right':
      return {
        x: box.centreX + box.halfWidth,
        y: box.centreY + clamp((towards.y - box.centreY) * SLIDE, -box.halfHeight * LIMIT, box.halfHeight * LIMIT),
      };
    case 'top':
      return {
        x: box.centreX + clamp((towards.x - box.centreX) * SLIDE, -box.halfWidth * LIMIT, box.halfWidth * LIMIT),
        y: box.centreY - box.halfHeight,
      };
    case 'bottom':
      return {
        x: box.centreX + clamp((towards.x - box.centreX) * SLIDE, -box.halfWidth * LIMIT, box.halfWidth * LIMIT),
        y: box.centreY + box.halfHeight,
      };
  }
}

/** One step out of a box, perpendicular to the given side. */
function stepOut(point: Point, side: Side, distance = ROUTE_STUB): Point {
  switch (side) {
    case 'left':
      return { x: point.x - distance, y: point.y };
    case 'right':
      return { x: point.x + distance, y: point.y };
    case 'top':
      return { x: point.x, y: point.y - distance };
    case 'bottom':
      return { x: point.x, y: point.y + distance };
  }
}

/**
 * Joins two stub ends. `facing` is true when the two sides look at each other,
 * which earns the symmetric Z; every other pairing gets a single elbow, so an
 * orthogonal route is always available even when the sides disagree.
 */
function connectHorizontal(p: Point, q: Point, facing: boolean): Point[] {
  if (facing) {
    const corridor = (p.x + q.x) / 2;
    return [
      { x: corridor, y: p.y },
      { x: corridor, y: q.y },
      q,
    ];
  }
  if (Math.abs(p.y - q.y) < 0.01) return [q];
  return [
    { x: q.x, y: p.y },
    q,
  ];
}

function connectVertical(p: Point, q: Point, facing: boolean): Point[] {
  if (facing) {
    const corridor = (p.y + q.y) / 2;
    return [
      { x: p.x, y: corridor },
      { x: q.x, y: corridor },
      q,
    ];
  }
  if (Math.abs(p.x - q.x) < 0.01) return [q];
  return [
    { x: p.x, y: q.y },
    q,
  ];
}

function orthogonalRoute(
  a: Point,
  aSide: Side,
  b: Point,
  bSide: Side,
  mode: 'orthogonal-h' | 'orthogonal-v',
): Point[] {
  const stubA = stepOut(a, aSide);
  const stubB = stepOut(b, bSide);

  if (mode === 'orthogonal-h') {
    const facing =
      (aSide === 'right' && bSide === 'left' && stubA.x <= stubB.x) ||
      (aSide === 'left' && bSide === 'right' && stubA.x >= stubB.x);
    return dedupePoints([a, stubA, ...connectHorizontal(stubA, stubB, facing), b]);
  }

  const facing =
    (aSide === 'bottom' && bSide === 'top' && stubA.y <= stubB.y) ||
    (aSide === 'top' && bSide === 'bottom' && stubA.y >= stubB.y);
  return dedupePoints([a, stubA, ...connectVertical(stubA, stubB, facing), b]);
}

/**
 * Pushes a point that sits inside a box out to the box boundary, along the
 * direction of the segment that follows. Points already outside are untouched,
 * so an authored anchor is never moved.
 */
function pushOutOfBox(point: Point, towards: Point, box: Box): Point {
  const rect = rectOfBox(box);
  if (!rectContainsPoint(rect, point, 0.5)) return point;

  const dx = towards.x - point.x;
  const dy = towards.y - point.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return point;

  const reachX = Math.abs(dx) > 0.001 ? box.halfWidth / Math.abs(dx) : Infinity;
  const reachY = Math.abs(dy) > 0.001 ? box.halfHeight / Math.abs(dy) : Infinity;
  const t = Math.min(reachX, reachY);

  return { x: point.x + dx * t, y: point.y + dy * t };
}

/**
 * Builds the polyline for one connection.
 *
 * `auto` is deliberately conservative: with authored sides it routes
 * orthogonally, without them it keeps the centre-to-centre straight line and
 * trims it back to the boxes, which is exactly how specs written before
 * routing existed already render.
 */
export function routeConnection(
  connection: ArchConnection,
  fromBox: Box,
  toBox: Box,
  frame: Frame,
): RoutedConnection {
  const mode: RouteMode = connection.route ?? 'auto';
  const auto = autoSides(fromBox, toBox);
  const fromSide = connection.fromSide ?? auto.from;
  const toSide = connection.toSide ?? auto.to;
  const hasAuthoredSide = Boolean(connection.fromSide || connection.toSide);

  let points: Point[];

  if (mode === 'auto' && !hasAuthoredSide) {
    points = [
      { x: fromBox.centreX, y: fromBox.centreY },
      { x: toBox.centreX, y: toBox.centreY },
    ];
  } else {
    const start = sideAnchor(fromBox, fromSide, { x: toBox.centreX, y: toBox.centreY });
    const end = sideAnchor(toBox, toSide, { x: fromBox.centreX, y: fromBox.centreY });

    if (mode === 'straight') {
      points = [start, end];
    } else if (mode === 'orthogonal-v') {
      points = orthogonalRoute(start, fromSide, end, toSide, 'orthogonal-v');
    } else if (mode === 'orthogonal-h') {
      points = orthogonalRoute(start, fromSide, end, toSide, 'orthogonal-h');
    } else {
      // auto with authored sides: the axis follows the exit side.
      const axis = HORIZONTAL_SIDES.includes(fromSide) ? 'orthogonal-h' : 'orthogonal-v';
      points = orthogonalRoute(start, fromSide, end, toSide, axis);
    }
  }

  const via = connection.via;
  if (via?.length) {
    points = routeThroughWaypoints(
      points[0],
      points[points.length - 1],
      via.map(([x, y]) => ({ x: (x / 100) * frame.width, y: (y / 100) * frame.height })),
    );
  }

  const first = pushOutOfBox(points[0], points[1] ?? points[0], fromBox);
  const lastIndex = points.length - 1;
  const last = pushOutOfBox(points[lastIndex], points[lastIndex - 1] ?? points[lastIndex], toBox);
  const routed = simplifyPoints(dedupePoints([first, ...points.slice(1, -1), last]));

  const label = connection.label ?? '';
  const placed = placeLabel(routed, fromBox, toBox, connection, frame);

  return {
    id: connectionId(connection),
    from: connection.from,
    to: connection.to,
    points: routed,
    d: pathFromPoints(routed),
    label,
    labelPoint: placed.point,
    labelPlacement: placed.placement,
    variant: connectionVariant(connection),
    bidirectional: connection.bidirectional ?? false,
    color: connection.color ?? null,
    width: connectionWidth(connection),
  };
}

/** Waypoints are corners: each leg is an elbow, so the whole route stays orthogonal. */
function routeThroughWaypoints(start: Point, end: Point, waypoints: Point[]): Point[] {
  const stops = [start, ...waypoints, end];
  const points: Point[] = [start];

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const next = stops[index];
    const isLast = index === stops.length - 1;
    const leg = connectHorizontal(previous, next, false);

    if (isLast) points.push(...leg);
    else points.push(...leg.slice(0, -1), next);
  }

  return points;
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return total;
}

/** Point at `ratio` of the way along the polyline, by arc length. */
export function pointAlong(points: Point[], ratio: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const target = polylineLength(points) * ratio;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const segment = Math.hypot(next.x - previous.x, next.y - previous.y);
    if (travelled + segment >= target) {
      const t = segment === 0 ? 0 : (target - travelled) / segment;
      return { x: previous.x + (next.x - previous.x) * t, y: previous.y + (next.y - previous.y) * t };
    }
    travelled += segment;
  }
  return points[points.length - 1];
}

/** Midpoint of a numbered segment, clamped to the segments that exist. */
export function segmentMidpoint(points: Point[], index: number): Point {
  const segment = clamp(index, 0, Math.max(points.length - 2, 0));
  const a = points[segment];
  const b = points[segment + 1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Where the label goes.
 *
 * Authored placement wins, then an authored segment. Otherwise the label sits
 * mid-route — except where the two boxes keep less clear space than a label
 * needs, where a centred label would be a chip straddling two boxes: it is
 * lifted clear of the row and anchored by its bottom edge instead.
 */
export function placeLabel(
  points: Point[],
  fromBox: Box,
  toBox: Box,
  connection: ArchConnection,
  frame: Frame,
): { point: Point; placement: 'above' | 'middle' } {
  let point: Point;
  let placement: 'above' | 'middle' = 'middle';

  if (connection.labelAt) {
    point = {
      x: (connection.labelAt[0] / 100) * frame.width,
      y: (connection.labelAt[1] / 100) * frame.height,
    };
  } else if (connection.labelSegment !== undefined) {
    point = segmentMidpoint(points, connection.labelSegment);
  } else if (points.length <= 3 && hasTightGap(fromBox, toBox)) {
    const topOfBoxes = Math.min(
      fromBox.centreY - fromBox.halfHeight,
      toBox.centreY - toBox.halfHeight,
    );
    const middle = pointAlong(points, 0.5);
    point = { x: middle.x, y: Math.max(topOfBoxes - 4, 4) };
    placement = 'above';
  } else {
    point = pointAlong(points, 0.5);
  }

  return {
    point: { x: point.x + (connection.labelDx ?? 0), y: point.y + (connection.labelDy ?? 0) },
    placement,
  };
}

/** Clear space needed either side of a label before it stops straddling boxes. */
const LABEL_CLEARANCE = 110;

function hasTightGap(fromBox: Box, toBox: Box): boolean {
  const dx = Math.abs(toBox.centreX - fromBox.centreX);
  const dy = Math.abs(toBox.centreY - fromBox.centreY);
  const gap =
    dx >= dy
      ? dx - (fromBox.halfWidth + toBox.halfWidth)
      : dy - (fromBox.halfHeight + toBox.halfHeight);
  return gap < LABEL_CLEARANCE;
}

/**
 * Segment/rectangle intersection, by parametric clipping. Used by the
 * validator: a route is allowed to touch a box it does not belong to, but not
 * to run through it.
 */
export function segmentIntersectsRect(a: Point, b: Point, rect: Rect, inset = 1): boolean {
  const left = rect.x + inset;
  const right = rect.x + rect.width - inset;
  const top = rect.y + inset;
  const bottom = rect.y + rect.height - inset;
  if (right <= left || bottom <= top) return false;

  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (!clip(-dx, a.x - left)) return false;
  if (!clip(dx, right - a.x)) return false;
  if (!clip(-dy, a.y - top)) return false;
  if (!clip(dy, bottom - a.y)) return false;

  return t1 - t0 > 0.02;
}

export function polylineIntersectsRect(points: Point[], rect: Rect, inset = 1): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (segmentIntersectsRect(points[index - 1], points[index], rect, inset)) return true;
  }
  return false;
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}
