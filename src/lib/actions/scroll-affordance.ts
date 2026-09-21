import { attachScrollAffordance } from '../scroll-affordance';

/**
 * `use:scrollAffordance` on the element that carries the overflow.
 *
 * The action form is for boxes a component creates after the document
 * decorator has already run — a tab panel mounted on click, say. Anything
 * present at commit time is covered by decorate-scrollable.ts instead.
 */
export function scrollAffordance(el: HTMLElement) {
  return { destroy: attachScrollAffordance(el) };
}
