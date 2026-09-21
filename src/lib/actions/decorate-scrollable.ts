import { attachScrollAffordance } from '../scroll-affordance';

/**
 * Scroll regions the document was never able to mark up.
 *
 * Markdown tables and highlighted code are emitted by the compiler, so no
 * component can put an action on them; this walks the committed document and
 * attaches the same affordance by hand. Same shape as decorate-code.ts, and
 * it returns a teardown.
 */
const SCROLLABLE = '.prose table, pre.shiki, pre[data-code-block]';

export function decorateScrollable(root: HTMLElement): () => void {
  const disposers: Array<() => void> = [];

  for (const el of root.querySelectorAll<HTMLElement>(SCROLLABLE)) {
    // A table inside a component's own scroll box — DataTable's — is already
    // covered by the box around it, and would only fade its own edge twice.
    if (el.closest('[data-scroll-affordance]')) continue;
    disposers.push(attachScrollAffordance(el));
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}
