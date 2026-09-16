# Technical Static Document Generator

A high-performance, offline-first technical documentation engine built with **Svelte 5**, **Vite**, **MDsveX**, **Tailwind CSS 4**, and **DaisyUI 5**.

**Crucial architecture constraint:** it compiles into exactly **one standalone `index.html`** that runs natively from `file://` with zero network requests — no CDN, no external fonts, no runtime fetches. Every decision below is bounded by that constraint.

---

## Key features

1. **Standalone single-file artifact.** `vite-plugin-singlefile` inlines all JS, CSS, icons and WASM into `dist/index.html`. Open it directly from the filesystem.
2. **One design-token layer.** Colours, radii, type scale and density live in `src/theme/tokens.css`. Re-skinning for a different brand is a config edit, never a component edit.
3. **Build-time content index.** A Vite plugin reads `src/content/**/*.svx` and emits search records. A new document is searchable the moment the file lands.
4. **Copy button on every code block.** A post-render pass decorates every `<pre>` with a language chip and copy button, with a `file://`-safe clipboard fallback.
5. **Deep-linkable headings.** Hash grammar `#/<docId>/<sectionSlug>`, with a sticky on-this-page rail and scroll spy.
6. **Dual-themed Shiki.** Both themes render simultaneously into CSS custom properties, so switching presets costs no re-highlight.
7. **Authored architecture diagrams.** A hand-placed topology — boundaries, side-contracted routing, labelled relationships — checked by a linter and by a measured pass in the browser, and exportable as a dual-theme SVG or a PNG.

---

## Getting started

```bash
bun install
bun run dev              # development server
bun run build            # → dist/index.html
bun run check            # svelte-check
bun run check:diagrams   # lint the diagram specs in src/content
```

---

## Deploying

`.github/workflows/pages.yml` runs the checks, builds, and publishes to GitHub Pages on every push to
the default branch. Pull requests get the checks and the build, without deploying.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Because the artifact is a single self-contained file with no absolute paths, it serves unchanged from
the project subpath — no `base` config, no rewrite rules, no server. The site lands at
`https://<owner>.github.io/<repo>/`, with `llms.txt` beside it at `/llms.txt`.

---

## The theme system

### One config surface

`src/theme/tokens.css` is the only file you edit to change how the product looks.

| Layer | Purpose |
|---|---|
| `@theme { }` | Declares the semantic vocabulary components speak: radii, fonts, text sizes. |
| `@plugin "daisyui/theme"` | One block per preset. Owns the palette, radii and effects. |
| `@plugin "daisyui" { themes: false }` | Suppresses DaisyUI's built-ins so exactly our presets ship. |

### Token vocabulary

Components reference **only** these:

```
surfaces   bg-base-100  bg-base-200  bg-base-300
text       text-base-content
edges      border-edge  border-edge-strong  bg-edge
radii      rounded-chip (3px)  rounded-edge (4px)  rounded-panel (6px)
type       text-micro (11px)  text-meta (12px)  text-body (15px)  text-title
```

**Banned in `src/lib/**`:** `rounded-2xl`, `rounded-3xl`, `border-base-content/N`, `text-[Npx]`, literal hex, `bg-slate-*`.

Verify with:

```bash
grep -rnE 'rounded-(2xl|3xl)|border-base-content/|text-\[1[0-9]px\]' src/lib
```

### Adding a preset

1. Add a `@plugin "daisyui/theme" { name: "…" }` block in `tokens.css`.
2. Add a row to `src/theme/presets.ts`.

No component changes. `ThemeSwitcher` and the pre-paint script in `index.html` pick it up automatically.

### Why two attributes

The theme controller writes both `data-theme` (DaisyUI's palette) and `data-color-scheme` (`light`/`dark`). Shiki, Mermaid and the `dark:` variant key off `data-color-scheme`, so renaming a preset never breaks a stylesheet rule.

### Diagram colours

Mermaid resolves its theme through a colour library that predates `oklch`, so each preset also declares a small `--diagram-*` palette in hex. Mermaid and the standalone SVG export both read it. Those values are derived from the same roles — see the comment in `tokens.css`.

---

## Adding a document

1. Create `src/content/NN-<id>.svx` — the filename stem after the numeric prefix is the document id.
2. Add an entry with that id to `src/config/sidebar.ts`.

That's it. Search records, the table of contents and prev/next navigation are all derived. A build warning fires if a content file has no sidebar entry.

Author in plain Markdown with any component mixed in:

````svx
# Title

<Callout type="warning" title="Careful">…</Callout>

```ts
const example = true;
```
````

---

## Components

| Component | Notes |
|---|---|
| `LayoutShell` | Three-column grid (sidebar / content / TOC), single source of truth for the route. |
| `Router` | Loads the document, decorates headings and code, scrolls to the requested section. |
| `SearchModal` | Native `<dialog>` command palette. Build-time index, grouped results, match highlighting. |
| `TocRail` | On-this-page outline with scroll spy. |
| `PageNav` | Prev/next from sidebar order. `Alt` + `←`/`→` works anywhere. |
| `ThemeSwitcher` | Preset toggle driven by `presets.ts`. |
| `Callout` | Note / warning / success / danger / tip. Colour + icon + label, never colour alone. |
| `Tabs` | ARIA tablist with arrow-key navigation. Copy button comes from the code decorator. |
| `ApiEndpoint` | Method, path, tabbed cURL / request / response. JSON bodies are tokenized. |
| `JsonTree` | Keyboard-navigable JSON tree: `↑↓` move, `→←` expand/collapse, `c` copies the subtree. |
| `MermaidDiagram` | `securityLevel: 'strict'`, token-driven theme, fullscreen mode. |
| `DiagramFrame` | Shared diagram chrome: title bar, controls, export menu, fullscreen view. |
| `ArchitectureCanvas` | Authored topology: boundaries, routed connections, variants, export. See [Diagrams](#diagrams). |
| `AdrViewer` | Architecture decision records with status filters. |

---

## Diagrams

Both diagram components share `DiagramFrame` (title bar, controls, export menu, and a fullscreen view
that covers 70% of the window and closes on Escape or a click outside) and the token vocabulary in
`src/lib/diagram/`. Nothing about a diagram is styled from a literal colour: node tones, connection
variants and boundaries all resolve through the theme, so adding a preset restyles them without
touching a component.

`ArchitectureCanvas` owns the spec, the diagnostics, the legend and the exports; `ArchitectureGraph`
draws one graph — measure, separate, fit, route — and is mounted twice, inline and behind the
fullscreen control, because the fit is relative to the box it is drawn in.

### The canvas

`ArchitectureCanvas.svelte` renders an authored topology from plain props:

```svx
const nodes = [
  { id: 'client', title: 'Local Browser', subtitle: 'file://', type: 'client', x: 15, y: 30 },
];
const connections = [
  { from: 'authoring', to: 'compiler', label: 'MDsveX compile', fromSide: 'right', toSide: 'left' },
];
const boundaries = [
  { id: 'build', kind: 'region', label: 'Build-time pipeline', wraps: ['authoring', 'compiler'] },
];

<ArchitectureCanvas title="…" nodes={nodes} connections={connections} boundaries={boundaries} />
```

- **`x` / `y`** are percentages of the canvas and describe the node's **centre**. Topology is authored,
  not solved: there is no layout engine, and the same spec always draws the same diagram.
- **`type`** picks the icon and tone (`client`, `gateway`, `service`, `database`, `security`, `cache`,
  `frontend`, `backend`, `cloud`, `messagebus`, `external`). **`variant`** (`emphasis`, `security`,
  `dashed`) is emphasis, independent of type.
- **`fromSide` / `toSide` / `route` / `via`** steer a connection. A side is a contract, not a hint: the
  first and last segment leave and enter perpendicular to it. With no sides authored the connection
  keeps the straight centre-to-centre line, which is how specs written before routing existed render.
- **`labelAt`, `labelDx` / `labelDy`, `labelSegment`** place a label. Labels are part of the
  relationship: reposition or shorten one, never delete it to clear a collision.
- **Boundaries** wrap nodes in a labelled region (`region`) or trust boundary (`security-group`). Their
  box is derived from the members; only `pad` is authored, and the top edge derives its own inset so a
  boundary label never lands in the same band as a relationship label lifted clear of the first row.

### Checking a spec

```bash
bun run check:diagrams
```

Reads every `const NAME = [...]` literal out of `src/content/*.svx` and runs the same validator the
canvas runs in the browser: duplicate and dangling ids, boundaries that wrap nothing or enclose a node
they do not claim, isolated nodes, nodes closer than the clear gap the layout is tuned for, routes
crossing a box, labels masking a node or another label. Structure is checked exactly; geometry uses
estimated box sizes in the script, so only the error count fails the run and warnings are advisory.
The browser-side pass measures the real boxes and reports through `console.warn`, with a badge and an
overlay in the toolbar — `?diagram-debug` turns that on when a dev server is running with
`NODE_ENV=production`, where `import.meta.env.DEV` is false.

### Export

The export menu downloads a standalone SVG, a PNG, or copies the SVG source. Both are rebuilt from the
spec and the measured layout rather than copied from the DOM, which is why an export never carries
selection, focus rings, pan/zoom state or the dev overlay. The SVG export can embed both themes behind
a `prefers-color-scheme` query, so one file reads correctly on light and dark.

---

## MCP servers

This project ships two project-scoped MCP servers in `.mcp.json`:

- **context7** — pulls version-specific library documentation on demand. Add `use context7` to a prompt to get current Tailwind / DaisyUI / Shiki APIs instead of relying on training data.
- **daisyui-docs** — reads the daisyUI repository on demand, so component and theme syntax is never guessed.

```bash
cmdc mcp list
```

The optional official [daisyUI Blueprint server](https://daisyui.com/blueprint/) needs a paid licence, so add it at **local** scope only — never commit its key:

```bash
cmdc mcp add-json --scope local daisyui-blueprint \
  '{"type":"stdio","command":"npx","args":["-y","daisyui-blueprint@latest"],
    "env":{"LICENSE":"…","EMAIL":"…"}}'
```

> On Windows the binary is `cmdc`; a bare `cmd` opens the Windows shell.

---

## Architecture notes

- **Shiki is build-time only.** It never enters the client bundle; `highlightCode` runs inside `vite.config.ts`. This is why the artifact stays a single file.
- **Mermaid ships only the diagrams the content uses.** Mermaid picks a renderer from a runtime string, so every diagram loader stays reachable — and a single-file build inlines dynamic imports, which makes lazy code into shipped bytes. `vite-plugins/adaptive-mermaid.ts` reads `src/content` at build time, keeps the implementations those diagrams need and stubs the rest, along with the layout engines and conditional dependencies they cannot reach. If a diagram's type cannot be proven from the source the build fails rather than pruning it out from under the author; if the scan cannot run at all, nothing is pruned.
- **Diagrams are laid out with Dagre, not ELK.** ELK is Mermaid 12's default for flowcharts and is ~1.4 MB, so `MermaidDiagram` pins `layout: 'dagre'` and `adaptive-mermaid` prunes ELK. Naming `elk` there — or `layout: elk` in a diagram — keeps it for the whole build, and the plugin reads that pin rather than assuming it.
- **The content index ships extracted text, not raw SVX.** `vite-plugins/docs-index.ts` strips markup before serialising, keeping the bundle small.
- **`src/lib/slugify.ts` is a contract.** It is imported by both the Node-side plugin and the browser heading decorator, which is the only reason a search result's anchor matches the rendered heading. Keep it dependency-free.
- **Document `<script>` blocks are not indexed.** Headings inside components (for example `AdrViewer`) get anchors and appear in the outline, but are not part of the build-time search index.
- **The diagram layer has no UI dependencies.** Nothing in `src/lib/diagram/` imports the DOM, Svelte or an icon module — which is the only reason `scripts/check-diagrams.ts` can run the same validator, over the same geometry, that the browser runs. Keep it that way; icons live in `src/lib/diagram/icons.ts` for exactly this reason.
- **`llms.txt` is the authoring contract for agents.** It carries the content workflow, the component props and the diagram spec in one file. Update it whenever the surface it describes changes.
