import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import {
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from '@shikijs/transformers';

// Import only the exact fine-grained grammars needed for docs
import langTs from 'shiki/langs/typescript.mjs';
import langJs from 'shiki/langs/javascript.mjs';
import langJson from 'shiki/langs/json.mjs';
import langBash from 'shiki/langs/bash.mjs';
import langPython from 'shiki/langs/python.mjs';
import langHtml from 'shiki/langs/html.mjs';
import langCss from 'shiki/langs/css.mjs';
import langSvelte from 'shiki/langs/svelte.mjs';
import langYaml from 'shiki/langs/yaml.mjs';

// Import dual themes
import themeLight from 'shiki/themes/github-light.mjs';
import themeDark from 'shiki/themes/github-dark.mjs';

/**
 * Fence-language aliases. Anything not listed but loaded still resolves; an
 * unknown language degrades to plain text rather than throwing.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  yml: 'yaml',
};

let highlighterPromise: ReturnType<typeof createHighlighterCore> | null = null;

export async function getHighlighterInstance() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [themeLight, themeDark],
      langs: [
        langTs,
        langJs,
        langJson,
        langBash,
        langPython,
        langHtml,
        langCss,
        langSvelte,
        langYaml,
      ],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    });
  }
  return highlighterPromise;
}

export async function highlightCode(code: string, lang = 'text'): Promise<string> {
  const highlighter = await getHighlighterInstance();

  const requested = lang.toLowerCase().trim();
  const resolved = LANGUAGE_ALIASES[requested] ?? requested;
  const loaded = highlighter.getLoadedLanguages();
  const target = loaded.includes(resolved) ? resolved : 'text';

  const html = highlighter.codeToHtml(code, {
    lang: target,
    themes: {
      light: 'github-light',
      dark: 'github-dark',
    },
    defaultColor: false,
    // Official option — replaces stripping tabindex="0" out of the output.
    tabindex: false,
    // Non-underscore `meta` entries become attributes on the root <pre>,
    // which is how the code decorator learns the language.
    meta: { 'data-language': target },
    transformers: [
      transformerNotationDiff(),
      transformerNotationHighlight(),
      transformerNotationWordHighlight(),
      transformerNotationErrorLevel(),
    ],
  });

  // Escape svelte curlies so mdsvex doesn't interpret them as expressions.
  const escaped = html.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');

  return `<div class="code-block">${escaped}</div>`;
}
