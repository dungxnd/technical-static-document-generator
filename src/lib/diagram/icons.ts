/**
 * Node type → icon.
 *
 * Kept out of the diagram model so the model stays importable from Node, and
 * shared by the canvas and its legend so a type can never be drawn with one
 * glyph and explained with another.
 */

import type { LucideIcon } from '@lucide/svelte';
import {
  Boxes,
  Cloud,
  Cpu,
  Database,
  Globe,
  Lock,
  MonitorSmartphone,
  Radio,
  Server,
  Shield,
  Zap,
} from '@lucide/svelte';
import type { NodeType } from './types';

export const NODE_ICONS: Record<NodeType, LucideIcon> = {
  client: Globe,
  gateway: Shield,
  service: Cpu,
  database: Database,
  cache: Zap,
  security: Lock,
  frontend: MonitorSmartphone,
  backend: Server,
  cloud: Cloud,
  messagebus: Radio,
  external: Boxes,
};
