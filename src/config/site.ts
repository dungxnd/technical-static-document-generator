import type { LucideIcon } from '@lucide/svelte';
import { Cpu } from '@lucide/svelte';

export interface SiteConfig {
  /** Product name shown in the header and the document title suffix. */
  name: string;
  /** Shown next to the name. Keep it short; it is hidden below `sm`. */
  badge: string;
  /** Words in the command palette and the footer. */
  tagline: string;
  icon: LucideIcon;
  /** Rendered as a quiet status line in the sidebar. */
  offlineNote?: string;
}

export const siteConfig: SiteConfig = {
  name: 'DocEngine',
  badge: 'offline',
  tagline: 'Technical documentation that runs from a single file',
  icon: Cpu,
  offlineNote: 'Single-file bundle. No network requests.',
};
