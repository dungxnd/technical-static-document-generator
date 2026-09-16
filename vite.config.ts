import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import tailwindcss from '@tailwindcss/vite';
import { mdsvex } from 'mdsvex';
import path from 'node:path';
import { highlightCode } from './src/lib/shiki-highlighter.ts';
import { docsIndex } from './vite-plugins/docs-index.ts';
import { adaptiveMermaid } from './vite-plugins/adaptive-mermaid.ts';

export default defineConfig({
  plugins: [
    adaptiveMermaid(),
    docsIndex(),
    tailwindcss(),
    svelte({
      extensions: ['.svelte', '.svx', '.md'],
      preprocess: [
        mdsvex({
          extensions: ['.svx', '.md'],
          highlight: {
            highlighter: async (code, lang) => {
              return await highlightCode(code, lang || 'text');
            },
          },
        }),
      ],
    }),
    viteSingleFile({
      useRecommendedBuildConfig: true,
      removeViteModuleLoader: true,
    }),
  ],
  resolve: {
    alias: {
      $lib: path.resolve(import.meta.dirname, './src/lib'),
      $components: path.resolve(import.meta.dirname, './src/lib/components'),
      $config: path.resolve(import.meta.dirname, './src/config'),
      $content: path.resolve(import.meta.dirname, './src/content'),
    },
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
  },
});
