import { mount, unmount } from 'svelte';
import { Check, Copy } from '@lucide/svelte';
import { copyText } from '../clipboard';

/** Blocks at least this tall get line numbers; shorter snippets do not. */
const LINE_NUMBER_THRESHOLD = 8;
const COPIED_RESET_MS = 1600;

/**
 * Matches `<identifier>` placeholders (1+ alphanumeric, underscore, or dash characters).
 * Strictly requires at least one character inside `<>` (rejecting empty `<>`), and must be within the same line.
 */
const PLACEHOLDER_REGEX = /<([a-zA-Z0-9_-]+)>/g;

/** Character-offset span for a single text node within a concatenated line string. */
type NodeRange = { node: Text; start: number; end: number };

/** Monotonically incrementing counter used to give each input a unique stable id. */
let placeholderIdCounter = 0;

/**
 * Adds a header bar with the language and a copy button to every code block in
 * the document, enables line numbers on longer ones, and turns <placeholder> tokens
 * into interactive editable inputs (unless `data-placeholders="false"` or `data-no-placeholders` is specified).
 *
 * Compatible with `$effect(() => decorateCode(container))` and Svelte action `<pre use:decorateCode>`.
 * Returns a teardown function with an additional `.destroy` property for Svelte action compatibility.
 */
export function decorateCode(root: HTMLElement): (() => void) & { destroy: () => void } {
  const controller = new AbortController();
  const disposers: Array<() => void> = [];

  // Support both container elements (querySelectorAll) and direct <pre> targets (use:action).
  const selector = 'pre.shiki, pre[data-code-block]';
  const targets: HTMLPreElement[] = [];
  if (root.matches?.(selector)) targets.push(root as HTMLPreElement);
  targets.push(...root.querySelectorAll<HTMLPreElement>(selector));

  for (const pre of targets) {
    if (pre.dataset.codeDecorated === 'true') continue;
    pre.dataset.codeDecorated = 'true';

    // Track which dataset keys we add so teardown only removes what we set.
    const hadLanguage = 'language' in pre.dataset;
    if (!hadLanguage) pre.dataset.language = detectLanguage(pre);

    const lineCount =
      pre.querySelectorAll('.line').length ||
      (pre.textContent ?? '').replace(/\r?\n$/, '').split(/\r?\n/).length;
    const hadLineNumbers = 'lineNumbers' in pre.dataset;
    if (!hadLineNumbers && lineCount >= LINE_NUMBER_THRESHOLD) {
      pre.dataset.lineNumbers = '';
    }

    // Allow opting out via data-placeholders="false" or data-no-placeholders on the pre or code-block container
    const isPlaceholdersDisabled =
      pre.dataset.placeholders === 'false' ||
      pre.hasAttribute('data-no-placeholders') ||
      pre.closest('.code-block')?.getAttribute('data-placeholders') === 'false' ||
      pre.closest('.code-block')?.hasAttribute('data-no-placeholders');

    let cleanupPlaceholders: (() => void) | undefined;
    if (!isPlaceholdersDisabled) {
      cleanupPlaceholders = decoratePlaceholders(pre, controller.signal);
    }

    const { container, isNew } = ensureContainer(pre);
    const cleanupBar = buildBar(pre, container, controller.signal);

    disposers.push(() => {
      cleanupBar();
      cleanupPlaceholders?.();
      if (isNew) container.replaceWith(pre);
      if (!hadLineNumbers) delete pre.dataset.lineNumbers;
      if (!hadLanguage) delete pre.dataset.language;
      delete pre.dataset.codeDecorated;
    });
  }

  function teardown() {
    controller.abort();
    for (const dispose of disposers) dispose();
  }
  (teardown as (() => void) & { destroy: () => void }).destroy = teardown;
  return teardown as (() => void) & { destroy: () => void };
}

function detectLanguage(pre: HTMLPreElement): string {
  const codeEl = pre.querySelector('code');

  // Explicit lang/data-language/data-lang attributes take highest priority.
  const langAttr =
    pre.getAttribute('data-language') ??
    pre.getAttribute('data-lang') ??
    pre.getAttribute('lang') ??
    codeEl?.getAttribute('data-language') ??
    codeEl?.getAttribute('data-lang') ??
    codeEl?.getAttribute('lang');
  if (langAttr) return langAttr.toLowerCase();

  // Fall back to language-* class on the code element (Shiki / highlight.js convention).
  const classSource = `${pre.className} ${codeEl?.className ?? ''}`;
  const match = /(?:language|lang)-([\w-]+)/.exec(classSource);
  return (match?.[1] ?? 'text').toLowerCase();
}

function ensureContainer(pre: HTMLPreElement): { container: HTMLElement; isNew: boolean } {
  const parent = pre.parentElement;
  if (parent?.classList.contains('code-block')) return { container: parent, isNew: false };

  const wrapper = document.createElement('div');
  wrapper.className = 'code-block';
  pre.replaceWith(wrapper);
  wrapper.append(pre);
  return { container: wrapper, isNew: true };
}

function buildBar(
  pre: HTMLPreElement,
  container: HTMLElement,
  signal: AbortSignal
): () => void {
  const bar = document.createElement('div');
  bar.className = 'code-bar';

  const label = document.createElement('span');
  label.className = 'code-lang';
  label.textContent = pre.dataset.language ?? 'text';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-ghost btn-xs gap-1.5 h-7 min-h-7 px-2 rounded-edge';
  button.setAttribute('aria-label', `Copy ${label.textContent} snippet`);

  const iconHost = document.createElement('span');
  iconHost.className = 'contents';
  iconHost.setAttribute('aria-hidden', 'true');

  // Both icons are mounted once at setup time; click handler just toggles display.
  const copyIconTarget = document.createElement('span');
  const checkIconTarget = document.createElement('span');
  checkIconTarget.style.display = 'none';
  iconHost.append(copyIconTarget, checkIconTarget);

  const text = document.createElement('span');
  text.className = 'text-micro';
  text.textContent = 'Copy';

  // status lives outside the button so that aria-label on the button does not
  // suppress the live region announcement for screen readers.
  const status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  button.append(iconHost, text);
  bar.append(label, button, status);
  container.prepend(bar);

  const copyIcon = mount(Copy, { target: copyIconTarget, props: { size: 13 } });
  const checkIcon = mount(Check, { target: checkIconTarget, props: { size: 13 } });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let isDestroyed = false;
  let isBusy = false;

  button.addEventListener(
    'click',
    async (e) => {
      e.stopPropagation();
      if (isBusy || isDestroyed) return;
      isBusy = true;

      const codeEl = pre.querySelector('code');
      const code = codeEl ? extractCodeContent(codeEl, pre) : pre.textContent ?? '';

      let ok = false;
      try {
        ok = await copyText(code);
      } catch {
        ok = false;
      }

      if (isDestroyed) return;
      if (timer) clearTimeout(timer);

      if (ok) {
        copyIconTarget.style.display = 'none';
        checkIconTarget.style.display = '';
        text.textContent = 'Copied';
        button.setAttribute('aria-label', 'Copied snippet to clipboard');
        status.textContent = 'Copied to clipboard';
      } else {
        copyIconTarget.style.display = '';
        checkIconTarget.style.display = 'none';
        text.textContent = 'Press Ctrl+C';
        button.setAttribute('aria-label', 'Copy failed');
        status.textContent = 'Copy failed, select the code manually';
      }

      timer = setTimeout(() => {
        if (isDestroyed) return;
        copyIconTarget.style.display = '';
        checkIconTarget.style.display = 'none';
        text.textContent = 'Copy';
        button.setAttribute('aria-label', `Copy ${label.textContent} snippet`);
        status.textContent = '';
        isBusy = false;
      }, COPIED_RESET_MS);
    },
    { signal }
  );

  return () => {
    isDestroyed = true;
    if (timer) clearTimeout(timer);
    void unmount(copyIcon);
    void unmount(checkIcon);
    bar.remove();
  };
}

/**
 * Extracts plain text from a code element or cloned DocumentFragment, reading live
 * input values for placeholders and preserving Shiki line breaks without browser
 * selection-serialization artifacts.
 */
function extractCodeContent(root: Element | DocumentFragment, pre: HTMLPreElement): string {
  const lines = root.querySelectorAll<HTMLElement>('.line');
  if (lines.length > 0) {
    return Array.from(lines)
      .map((line) => extractNodeText(line, pre).replace(/\r?\n$/, ''))
      .join('\n');
  }
  return extractNodeText(root, pre);
}

function extractNodeText(root: Node, pre: HTMLPreElement): string {
  let result = '';

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.nodeValue ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === 'INPUT' && el.classList.contains('code-placeholder-input')) {
        // Resolve the live input from `pre` via its stable id so cloned fragments
        // (from range.cloneContents()) return the current typed value, not the clone's.
        const placeholderId = el.dataset.placeholderId;
        const liveInput = placeholderId
          ? pre.querySelector<HTMLInputElement>(
              `input.code-placeholder-input[data-placeholder-id="${CSS.escape(placeholderId)}"]`
            )
          : null;
        const target = liveInput ?? (el as HTMLInputElement);
        const val = target.value.trim();
        result += val !== '' ? target.value : (target.dataset.rawTag ?? '');
      } else {
        for (let i = 0; i < el.childNodes.length; i++) {
          walk(el.childNodes[i]);
        }
      }
    }
  }

  walk(root);
  return result;
}

/**
 * Scans lines inside the code element and converts `<placeholder>` patterns into editable inline inputs.
 * Handles both plain single text nodes and syntax-highlighted lines where Shiki may split `<identifier>`
 * across multiple adjacent token spans (e.g. `<span>=<</span><span>identifier</span><span>></span>`).
 */
function decoratePlaceholders(pre: HTMLPreElement, signal: AbortSignal): () => void {
  const codeEl = pre.querySelector('code');
  if (!codeEl) return () => {};

  const lines = codeEl.querySelectorAll<HTMLElement>('.line');
  const lineContainers: HTMLElement[] = lines.length > 0 ? Array.from(lines) : [codeEl];
  const inputs: HTMLInputElement[] = [];

  for (const lineEl of lineContainers) {
    decorateLinePlaceholders(lineEl, pre, inputs, signal);
  }

  // Intercept manual select+copy (Ctrl+C / ⌘C). The browser's native serializer
  // inserts \n around <input> elements; we extract the exact selected content ourselves
  // using range.cloneContents() so partial selections are preserved without spurious newlines.
  pre.addEventListener(
    'copy',
    (e) => {
      // If the user is selecting text inside an active input, let the browser copy natively.
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement &&
        active.selectionStart !== active.selectionEnd
      ) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

      const pieces: string[] = [];
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        // Only intercept ranges that belong to this code block.
        if (!pre.contains(range.commonAncestorContainer)) return;
        pieces.push(extractCodeContent(range.cloneContents(), pre));
      }

      const cleanText = pieces.join('\n');
      if (cleanText && e.clipboardData) {
        e.preventDefault();
        e.clipboardData.setData('text/plain', cleanText);
      }
    },
    { signal }
  );

  return () => {
    // Restore each input to its raw token text and merge adjacent text nodes.
    for (const input of inputs) {
      input.replaceWith(document.createTextNode(input.dataset.rawTag ?? input.value));
    }
    codeEl.normalize();
  };
}

/** Syncs the width of an input to its content, keeping it at least as wide as the placeholder. */
function syncInputWidth(input: HTMLInputElement): void {
  const len = Math.max(input.value.length, input.placeholder.length, 1);
  input.style.width = `${len}ch`;
}

/** Updates all other inputs that share the same placeholder name in the same code block. */
function syncSiblings(
  pre: HTMLPreElement,
  placeholderName: string,
  source: HTMLInputElement
): void {
  const siblings = pre.querySelectorAll<HTMLInputElement>(
    `input.code-placeholder-input[data-placeholder="${CSS.escape(placeholderName)}"]`
  );
  for (const sibling of siblings) {
    if (sibling === source) continue;
    sibling.value = source.value;
    sibling.setAttribute('value', source.value);
    if ('placeholderEmpty' in source.dataset) {
      sibling.dataset.placeholderEmpty = '';
    } else {
      delete sibling.dataset.placeholderEmpty;
    }
    syncInputWidth(sibling);
  }
}

/** Resets all inputs with the given placeholder name (including the caller) back to rawTag. */
function resetPlaceholders(
  pre: HTMLPreElement,
  placeholderName: string,
  rawTag: string
): void {
  const siblings = pre.querySelectorAll<HTMLInputElement>(
    `input.code-placeholder-input[data-placeholder="${CSS.escape(placeholderName)}"]`
  );
  for (const sibling of siblings) {
    sibling.value = rawTag;
    sibling.setAttribute('value', rawTag);
    sibling.dataset.placeholderEmpty = '';
    syncInputWidth(sibling);
  }
}

/** Factory that creates and fully configures a placeholder input element. */
function createPlaceholderInput(
  rawTag: string,
  placeholderName: string,
  pre: HTMLPreElement,
  signal: AbortSignal
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'code-placeholder-input';
  // Use rawTag as the live value so plain browser copy (Ctrl+C) picks up the token text
  // inline. data-placeholder-empty drives the "unedited" visual style via CSS.
  input.value = rawTag;
  input.setAttribute('value', rawTag); // keeps content-attribute in sync for cloneContents()
  input.placeholder = rawTag;
  input.dataset.placeholderEmpty = '';
  input.dataset.placeholder = placeholderName;
  input.dataset.rawTag = rawTag;
  input.dataset.placeholderId = String(++placeholderIdCounter);
  input.setAttribute('aria-label', `Value for ${rawTag}`);
  input.spellcheck = false;
  input.autocomplete = 'off';

  // Ensure ch-unit sizing and visual style match the surrounding code text.
  input.style.font = 'inherit';
  input.style.letterSpacing = 'inherit';
  input.style.color = 'inherit';
  input.style.boxSizing = 'content-box';

  // CSS UI Level 4 native auto-sizing where supported (progressive enhancement).
  if ('fieldSizing' in input.style) {
    (input.style as CSSStyleDeclaration & { fieldSizing: string }).fieldSizing = 'content';
  }

  // Defer selection into rAF so WebKit/Blink mouseup does not immediately clear it.
  input.addEventListener(
    'focus',
    () => {
      if ('placeholderEmpty' in input.dataset) {
        requestAnimationFrame(() => input.select());
      }
    },
    { signal }
  );

  input.addEventListener(
    'input',
    () => {
      input.setAttribute('value', input.value);
      // Re-mark as unedited if the user types back the original token exactly.
      if (input.value === '' || input.value === rawTag) {
        input.dataset.placeholderEmpty = '';
      } else {
        delete input.dataset.placeholderEmpty;
      }
      syncInputWidth(input);
      syncSiblings(pre, placeholderName, input);
    },
    { signal }
  );

  input.addEventListener(
    'blur',
    () => {
      if (input.value.trim() === '') {
        resetPlaceholders(pre, placeholderName, rawTag);
      }
    },
    { signal }
  );

  input.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        resetPlaceholders(pre, placeholderName, rawTag);
        input.blur();
      } else {
        e.stopPropagation();
      }
    },
    { signal }
  );

  syncInputWidth(input);
  return input;
}

/**
 * Resolves a character offset in the concatenated line string to a specific text node
 * and the local offset within it.
 * @param isEnd - when true, treats the offset as an exclusive end boundary (used for range.setEnd).
 */
function findNodeAndOffset(
  offset: number,
  nodeRanges: NodeRange[],
  isEnd: boolean
): { node: Text; offset: number } | null {
  for (const nr of nodeRanges) {
    const match = isEnd
      ? nr.start < offset && offset <= nr.end
      : nr.start <= offset && offset < nr.end;
    if (match) return { node: nr.node, offset: offset - nr.start };
  }
  return null;
}

function decorateLinePlaceholders(
  lineEl: HTMLElement,
  pre: HTMLPreElement,
  inputs: HTMLInputElement[],
  signal: AbortSignal
): void {
  // Collect all non-empty text nodes in document order.
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let curr: Node | null;
  while ((curr = walker.nextNode())) {
    if (curr.nodeValue) textNodes.push(curr as Text);
  }

  if (textNodes.length === 0) return;

  // Build a concatenated string of the whole line and record each node's character range.
  let fullText = '';
  const nodeRanges: NodeRange[] = [];
  for (const node of textNodes) {
    const val = node.nodeValue ?? '';
    nodeRanges.push({ node, start: fullText.length, end: fullText.length + val.length });
    fullText += val;
  }

  if (!fullText.includes('<')) return;

  const matches = Array.from(fullText.matchAll(PLACEHOLDER_REGEX));
  if (matches.length === 0) return;

  // Process right-to-left: character indices and text node references to the left stay valid
  // across each Range mutation, including the case where multiple matches share one text node.
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const matchStart = match.index!;
    const matchEnd = matchStart + match[0].length;

    const startLoc = findNodeAndOffset(matchStart, nodeRanges, false);
    const endLoc = findNodeAndOffset(matchEnd, nodeRanges, true);
    if (!startLoc || !endLoc) continue;

    const input = createPlaceholderInput(match[0], match[1], pre, signal);
    inputs.push(input);

    const range = document.createRange();
    range.setStart(startLoc.node, startLoc.offset);
    range.setEnd(endLoc.node, endLoc.offset);
    range.deleteContents();
    range.insertNode(input);
  }

  // Remove any empty spans left behind after token text nodes were deleted.
  for (const span of lineEl.querySelectorAll<HTMLElement>('span:empty')) {
    if (span !== lineEl) span.remove();
  }
}
