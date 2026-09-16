import { mount, unmount } from 'svelte';
import { Check, Copy } from '@lucide/svelte';
import { copyText } from '../clipboard';

/** Blocks at least this tall get line numbers; shorter snippets do not. */
const LINE_NUMBER_THRESHOLD = 8;
const COPIED_RESET_MS = 1600;

/**
 * Adds a header bar with the language and a copy button to every code block in
 * the document, and enables line numbers on longer ones.
 *
 * A runtime pass rather than a Shiki transformer: this has to cover blocks that
 * components emit themselves (ApiEndpoint, Tabs) as well as blocks authored in
 * .svx, and those never pass through the highlighter.
 *
 * Returns a teardown that unmounts the icon components it created.
 */
export function decorateCode(root: HTMLElement): () => void {
  const disposers: Array<() => void> = [];

  for (const pre of root.querySelectorAll<HTMLPreElement>('pre.shiki, pre[data-code-block]')) {
    if (pre.dataset.codeDecorated === 'true') continue;
    pre.dataset.codeDecorated = 'true';

    if (!pre.dataset.language) pre.dataset.language = detectLanguage(pre);

    if (pre.querySelectorAll('.line').length >= LINE_NUMBER_THRESHOLD) {
      pre.dataset.lineNumbers = '';
    }

    const container = ensureContainer(pre);
    disposers.push(buildBar(pre, container));
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

function detectLanguage(pre: HTMLPreElement): string {
  const fromClass = pre.querySelector('code[class*="language-"]')?.className;
  const match = typeof fromClass === 'string' ? /language-([\w-]+)/.exec(fromClass) : null;
  return (match?.[1] ?? 'text').toLowerCase();
}

function ensureContainer(pre: HTMLPreElement): HTMLElement {
  const parent = pre.parentElement;
  if (parent?.classList.contains('code-block')) return parent;

  const wrapper = document.createElement('div');
  wrapper.className = 'code-block';
  pre.replaceWith(wrapper);
  wrapper.append(pre);
  return wrapper;
}

function buildBar(pre: HTMLPreElement, container: HTMLElement): () => void {
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

  const text = document.createElement('span');
  text.className = 'text-micro';

  const status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');

  button.append(iconHost, text, status);
  bar.append(label, button);
  container.prepend(bar);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let icon = mount(Copy, { target: iconHost, props: { size: 13 } });

  button.addEventListener('click', () => {
    const code = pre.querySelector('code')?.textContent ?? '';
    void copyText(code).then((ok) => {
      if (timer) clearTimeout(timer);
      void unmount(icon);
      icon = mount(ok ? Check : Copy, { target: iconHost, props: { size: 13 } });
      text.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      status.textContent = ok ? 'Copied to clipboard' : 'Copy failed, select the code manually';

      timer = setTimeout(() => {
        void unmount(icon);
        icon = mount(Copy, { target: iconHost, props: { size: 13 } });
        text.textContent = 'Copy';
        status.textContent = '';
      }, COPIED_RESET_MS);
    });
  });

  return () => {
    if (timer) clearTimeout(timer);
    void unmount(icon);
  };
}
