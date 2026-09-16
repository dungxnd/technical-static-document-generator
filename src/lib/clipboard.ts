/**
 * Clipboard access that survives the `file://` protocol.
 *
 * `navigator.clipboard` requires a secure context, and the whole point of this
 * artifact is that it is opened straight off disk. Where the async API is
 * missing or rejected we fall back to a hidden textarea + execCommand, which
 * still works in the file:// case.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* rejected (permissions, non-secure context) — try the legacy path */
  }

  return copyViaTextarea(text);
}

function copyViaTextarea(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none;';

  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(textarea);

  try {
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    active?.focus?.();
  }
}
