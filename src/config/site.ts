import type { Component } from 'svelte';
import type { LucideIcon } from '@lucide/svelte';
import { Cpu } from '@lucide/svelte';

export interface SiteConfig {
  /** Product name shown in the header and the document title suffix. */
  name: string;
  /** Shown next to the name. Keep it short; it is hidden below `sm`. Omit to hide the badge entirely. */
  badge?: string;
  /** Words in the command palette and the footer. */
  tagline: string;
  /**
   * Component or LucideIcon used as the brand logo.
   * Can be a Lucide icon, a custom Svelte SVG component, or omitted if using `logoSvg`.
   */
  icon?: Component<{ size?: number; class?: string }> | LucideIcon;
  /**
   * Raw inline SVG string for the brand logo.
   * When provided, it renders directly without any box background.
   */
  logoSvg?: string;
  /**
   * Optional custom logo image URL (or data URI).
   */
  logoSrc?: string;
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
