/**
 * The diagram contract.
 *
 * Shared by the Svelte renderer, the composition validator, the canonical SVG
 * export and the Node-side `check:diagrams` script — so this module stays free
 * of DOM, Svelte and icon imports. It owns the vocabulary and the numbers;
 * icons stay with the renderer.
 */

/** Semantic colour role. Resolved to a `--color-*` token by the consumers. */
export type Tone =
  | 'neutral'
  | 'info'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'error';

/**
 * Component vocabulary. The first six are this project's original names; the
 * rest widen it so a spec can describe parts it does not own.
 */
export type NodeType =
  | 'client'
  | 'gateway'
  | 'service'
  | 'database'
  | 'security'
  | 'cache'
  | 'frontend'
  | 'backend'
  | 'cloud'
  | 'messagebus'
  | 'external';

/** Reported in the legend, so every type needs a human label. */
export interface TypeMeta {
  label: string;
  tone: Tone;
}

export const TYPE_META: Record<NodeType, TypeMeta> = {
  client: { label: 'Client', tone: 'info' },
  gateway: { label: 'Gateway', tone: 'secondary' },
  service: { label: 'Service', tone: 'primary' },
  database: { label: 'Database', tone: 'success' },
  cache: { label: 'Cache', tone: 'warning' },
  security: { label: 'Security', tone: 'error' },
  frontend: { label: 'Frontend', tone: 'info' },
  backend: { label: 'Backend', tone: 'primary' },
  cloud: { label: 'Cloud', tone: 'secondary' },
  messagebus: { label: 'Message bus', tone: 'warning' },
  external: { label: 'External', tone: 'neutral' },
};

export const DEFAULT_NODE_TYPE: NodeType = 'service';

/** Emphasis is orthogonal to type: a database can also be the highlight. */
export type NodeVariant = 'default' | 'emphasis' | 'security' | 'dashed';
export type ConnectionVariant = 'default' | 'emphasis' | 'security' | 'dashed';

export type BoundaryKind = 'region' | 'security-group';

export interface BoundaryMeta {
  label: string;
  tone: Tone;
}

export const BOUNDARY_META: Record<BoundaryKind, BoundaryMeta> = {
  region: { label: 'Region', tone: 'neutral' },
  'security-group': { label: 'Security group', tone: 'error' },
};

/**
 * A side is a direction contract, not a hint: the first and last segment of the
 * route run perpendicular to the side they leave or enter.
 */
export type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * `auto` keeps the authored sides when there are any and falls back to the
 * straight centre-to-centre line otherwise, which is what specs written before
 * routing existed already relied on.
 */
export type RouteMode = 'auto' | 'straight' | 'orthogonal-h' | 'orthogonal-v';

export type Severity = 'error' | 'warning';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A measured node, in canvas px. `centreX/centreY` is the node's anchor. */
export interface Box {
  centreX: number;
  centreY: number;
  halfWidth: number;
  halfHeight: number;
}

export interface ArchNode {
  id: string;
  title: string;
  type?: NodeType;
  variant?: NodeVariant;
  subtitle?: string;
  tags?: string[];
  /** Legacy alias for `variant: 'emphasis'`. */
  highlight?: boolean;
  /** Percentage of the canvas, 0-100. The coordinate is the node's centre. */
  x: number;
  y: number;
}

export interface ArchConnection {
  /** Stable identity. Defaults to `from->to`. */
  id?: string;
  from: string;
  to: string;
  /** Semantic data, not decoration: it carries the action or protocol. */
  label?: string;
  variant?: ConnectionVariant;
  /** Legacy alias for `variant: 'dashed'`. */
  dashed?: boolean;
  bidirectional?: boolean;
  /**
   * Escape hatch for a one-off colour. Prefer `variant`, which resolves through
   * the tokens and therefore follows the theme.
   */
  color?: string;
  fromSide?: Side;
  toSide?: Side;
  route?: RouteMode;
  /** Waypoints the route must pass through, as canvas percentages. */
  via?: [number, number][];
  /** Label anchor, as a canvas percentage. */
  labelAt?: [number, number];
  labelDx?: number;
  labelDy?: number;
  /** Zero-based segment of the route to anchor the label to. */
  labelSegment?: number;
  width?: number;
}

export interface ArchBoundary {
  id: string;
  kind: BoundaryKind;
  label: string;
  /** Ids of the nodes the boundary wraps. */
  wraps: string[];
  /** Clear space between the boundary edge and its members, in px. */
  pad?: number;
}

export interface DiagramDiagnostic {
  code: string;
  severity: Severity;
  message: string;
  /** Nodes, connections or boundaries the diagnostic points at. */
  ids: string[];
}

/** Minimum clear space between two node boxes, in px. */
export const NODE_GAP = 34;
/** Relaxation passes. Converges in a handful; capped so it can never hang. */
export const SEPARATION_PASSES = 40;
/**
 * Clear space between a boundary and the nodes it wraps, in px. Applies to the
 * sides and the bottom; the top edge is derived, see BOUNDARY_TOP_INSET.
 */
export const BOUNDARY_PAD = 18;
/**
 * Room the top edge gives itself, derived rather than authored.
 *
 * A boundary's own label and a relationship label lifted clear of the first row
 * want the same band, so the two are stacked: chip at the top, lifted labels
 * below it. Authors should never have to discover that number, so `pad` only
 * has to describe the boundary's clearance from its members.
 */
export const BOUNDARY_TOP_INSET = 44;
/** Routes thinner than this stop reading as a route. */
export const MIN_CONNECTION_WIDTH = 0.5;
export const MAX_CONNECTION_WIDTH = 6;
export const DEFAULT_CONNECTION_WIDTH = 1.5;
/** Space a route keeps from the box it leaves, before its first turn. */
export const ROUTE_STUB = 16;

/**
 * Breathing room kept around the fitted layout, in px: horizontally generous,
 * vertically tighter, because the canvas is deliberately short and wide and a
 * tall margin there would be paid for by making every node smaller.
 */
export const FIT_PADDING_X = 34;
export const FIT_PADDING_Y = 16;
export const FIT_MAX_SCALE = 1.6;
export const FIT_MAX_FILL = 0.9;

export function typeMeta(type: NodeType | undefined): TypeMeta {
  return TYPE_META[type ?? DEFAULT_NODE_TYPE] ?? TYPE_META[DEFAULT_NODE_TYPE];
}

export function nodeVariant(node: ArchNode): NodeVariant {
  return node.variant ?? (node.highlight ? 'emphasis' : 'default');
}

export function connectionVariant(connection: ArchConnection): ConnectionVariant {
  return connection.variant ?? (connection.dashed ? 'dashed' : 'default');
}

export function connectionWidth(connection: ArchConnection): number {
  const width = connection.width ?? DEFAULT_CONNECTION_WIDTH;
  return Math.min(Math.max(width, MIN_CONNECTION_WIDTH), MAX_CONNECTION_WIDTH);
}

/** Derived rather than required: a spec may leave it out and still be addressable. */
export function connectionId(connection: ArchConnection): string {
  return connection.id ?? `${connection.from}->${connection.to}`;
}

/** Ids are used in selectors and diagnostics, so they stay address-like. */
export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
