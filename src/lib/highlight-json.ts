/**
 * Minimal JSON tokenizer for snippets that never pass through Shiki.
 *
 * Build-time highlighting only sees code fenced in the markdown source. Values
 * handed to a component as strings (an endpoint's request/response body) are
 * runtime data, so they need a tiny tokenizer of their own to match the look of
 * the highlighted blocks around them.
 *
 * Text is escaped before any markup is added, so the result is safe for {@html}.
 */

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (character) => ESCAPES[character] ?? character);
}

export function highlightJson(source: string): string {
  let output = '';
  let cursor = 0;

  for (const match of source.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    output += escapeHtml(source.slice(cursor, at));

    if (match[1] !== undefined) {
      output += `<span class="tok-key">${escapeHtml(match[1])}</span>${escapeHtml(match[2] ?? '')}`;
    } else if (match[3] !== undefined) {
      output += `<span class="tok-str">${escapeHtml(match[3])}</span>`;
    } else if (match[4] !== undefined) {
      output += `<span class="tok-num">${escapeHtml(match[4])}</span>`;
    } else {
      output += `<span class="tok-lit">${escapeHtml(match[0])}</span>`;
    }

    cursor = at + match[0].length;
  }

  return output + escapeHtml(source.slice(cursor));
}

/** True when the text parses as JSON, so we only tokenize when it is real JSON. */
export function isJsonLike(source: string): boolean {
  const trimmed = source.trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}
