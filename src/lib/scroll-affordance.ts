/**
 * Says out loud that a box scrolls.
 *
 * A scroll container that does not announce itself is a hidden control: the
 * content just looks cut off at the frame. This marks which inline edge still
 * holds content (`data-overflow-x`), which the stylesheet turns into a fade,
 * and puts the box in the tab order only while it actually overflows — the
 * WCAG 2.1.1 keyboard requirement, without leaving a tab stop behind on a box
 * that turned out to fit.
 *
 * Components call this through the `scrollAffordance` action; markup no
 * component owns (markdown tables, highlighted code) goes through
 * `actions/decorate-scrollable.ts`. Both land here, and the guard below means
 * whichever runs first owns the element.
 */

/** Sub-pixel offsets and rounded layout values must not read as overflow. */
const EPSILON = 1;

const watched = new Map<Element, () => void>();
let resizeObserver: ResizeObserver | null = null;

/** One observer for the page — a document can hold dozens of scroll regions. */
function watch(el: Element, onChange: () => void) {
  resizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) watched.get(entry.target)?.();
  });

  watched.set(el, onChange);
  resizeObserver.observe(el);

  return () => {
    watched.delete(el);
    resizeObserver?.unobserve(el);
  };
}

/**
 * Which inline edges still have content beyond them. `start` is the inline
 * start, `end` the inline end, so the answer is already logical.
 */
function inlineEdges(el: HTMLElement): 'none' | 'start' | 'end' | 'both' {
  if (el.scrollWidth - el.clientWidth <= EPSILON) return 'none';

  // scrollLeft runs negative once the document is right-to-left, so only the
  // magnitude is meaningful.
  const offset = Math.abs(el.scrollLeft);
  const atStart = offset <= EPSILON;
  const atEnd = offset + el.clientWidth >= el.scrollWidth - EPSILON;

  if (atStart && atEnd) return 'none';
  if (atStart) return 'end';
  if (atEnd) return 'start';
  return 'both';
}

/** Whether either axis overflows — what earns the element a place in the tab order. */
function overflows(el: HTMLElement): boolean {
  return (
    el.scrollWidth - el.clientWidth > EPSILON ||
    el.scrollHeight - el.clientHeight > EPSILON
  );
}

export function attachScrollAffordance(el: HTMLElement): () => void {
  if (el.dataset.scrollAffordance === 'attached') return () => {};
  el.dataset.scrollAffordance = 'attached';

  // A tabindex the markup asked for is not ours to move.
  const authoredTabindex = el.getAttribute('tabindex');

  let frame = 0;
  const paint = () => {
    frame = 0;

    const edges = inlineEdges(el);
    if (edges === 'none') delete el.dataset.overflowX;
    else el.dataset.overflowX = edges;

    if (authoredTabindex !== null) return;
    if (overflows(el)) el.tabIndex = 0;
    else el.removeAttribute('tabindex');
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(paint);
  };

  el.addEventListener('scroll', schedule, { passive: true });
  const unwatch = watch(el, schedule);

  // The box can keep its size while its content changes — a sort, a filter, a
  // tab switch — so the children are watched as well.
  const mutations = new MutationObserver(schedule);
  mutations.observe(el, { childList: true, subtree: true, characterData: true });

  paint();

  return () => {
    if (frame) cancelAnimationFrame(frame);
    el.removeEventListener('scroll', schedule);
    mutations.disconnect();
    unwatch();
    delete el.dataset.scrollAffordance;
    delete el.dataset.overflowX;
    if (authoredTabindex === null) el.removeAttribute('tabindex');
  };
}
