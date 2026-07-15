# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

Crosswalk Generator: a fully client-side web app (Vite + Svelte) for building a
many-to-many crosswalk between two hierarchical classification systems (e.g.
NAICS ↔ NACE). Users upload two CSVs, browse each system as a tree, and link
codes together. Everything runs in the browser — no backend, no network calls;
data is auto-saved to `localStorage` and can be exported as JSON (project) or
a `.zip` of CSVs (crosswalk).

## Svelte version

This app uses **Svelte 5** (runes: `$state`, `$props`, `$derived`, `$effect`,
`$bindable`, and the `onclick`-style event attributes instead of `on:click`).
When adding or editing components, use Svelte 5 idioms, not Svelte 4's
`export let` / `on:event` / reactive `$:` statement syntax. See
https://svelte.dev/llms-small.txt for a condensed reference if unsure.

## Documentation map

- `README.md` — the project pitch and how to run/build/deploy it. Keep it
  high-level; it does not need to enumerate every feature or behavioral
  detail. Agent edits to this file are blocked at the tool-permission level
  (`.claude/settings.json` denies `Edit(README.md)`/`Write(README.md)`) — if
  README.md genuinely needs a change, tell the user what to update and let
  them make the edit themselves rather than trying to work around the block.
- `SPEC.md` — the actual specification: data model, hierarchy-building
  algorithm, mapping/undo-redo invariants, export row/column shapes, and
  expected UI behavior, written for an LLM (or contributor) that needs to
  know exactly how something is supposed to work before changing it. This is
  the file to read before modifying `src/lib/*.js` or any behavior it
  documents, and the file to update whenever that behavior changes —
  treating a stale `SPEC.md` as an incomplete change, the same way a stale
  README used to be treated before this file existed.
- `CLAUDE.md` (this file) — workflow/convention guidance for agents working
  in the repo, not a description of app behavior.

## Structure

- `src/lib/csv.js` — CSV parsing (PapaParse) + column-guessing heuristics for
  level/code/title/description. Title and description are guessed together
  (an explicit title/name/label-ish field name always wins the title slot
  over a longer description-ish column) since they compete for the same
  "free text" signal.
- `src/lib/hierarchy.js` — builds a tree from flat rows, either via an
  explicit level column (`buildHierarchy`) or auto-detected levels inferred
  from code structure (`assignAutoLevels` / `buildAutoHierarchy`, including
  NAICS-style hyphenated sector-range codes like "48-49" — see
  `effectiveLength`/`parseHyphenRange`). Auto-detect defaults to also
  synthesizing missing ancestor codes (`synthesizeMissingParents`), which
  re-derives a proper depth-first row order (not just "shallower first" —
  see the function's docstring for why that distinction matters) and sorts
  siblings naturally so synthesized codes land in their real position instead
  of always trailing after existing ones. `flattenTree` does the depth-first,
  expand/filter-aware flattening used by the tree UI;
  `expandToLeaves`/`compactCodes`/`leafCodesOf` convert between leaf codes
  (the only codes that matter for export) and their compacted parent-code
  display form.
- `src/lib/stores.js` — Svelte stores holding the two systems (`systemA`/
  `systemB`), the mapping *groups* (many-to-many, leaf-codes-only, one row per
  group not per pair — `{ id, name, aLeafCodes, bLeafCodes, note, approx }`),
  current selections, hover state (for cross-panel highlight), and undo/redo
  history over `mappings`; also owns localStorage autosave/restore and
  project export/import (JSON snapshot). A leaf code may belong to at most
  one *real* mapping group per side (always enforced, not a toggle) — see
  `SPEC.md`. The two systems are symmetric — the data model and every
  function that takes a `side` param use `'A'`/`'B'`, never "source"/"target"
  (there's no inherent direction; UI labels prefer the user's dataset name
  when one is set, falling back to "A"/"B"). `defaultGroupName` builds a new
  group's default name from its A-side leaf codes, semicolon-joined.
  `clearMappingsForSide` deletes every group touching one side (used when
  that side's file is replaced).
- `src/lib/crosswalk.js` — turns mapping groups into exportable crosswalk
  rows/CSV (N×N single-file `a_code,a_title,b_code,b_title,group_name,
  relationship,note`, plus A→name/name→B split forms) plus
  `downloadFile`/`downloadBlob` for triggering browser downloads.
- `src/lib/zip.js` — dependency-free ZIP archive writer (STORE/uncompressed
  method) used to bundle the three exported CSVs into one `.zip` download.
- `src/lib/tooltip.js` — the shared `fastTooltip` action + `tooltipState`
  store behind the app's fast-appearing hover tooltip; rendered by the single
  `<FastTooltip/>` mounted in `App.svelte`.
- `src/lib/strings.js` — all user-facing copy (static strings and small
  template functions for interpolation/pluralization), organized as one
  exported object per consuming component/module (e.g. `toolbar`,
  `treePanel`, `hierarchy`); a `common` section holds text shared across
  files (e.g. the "A"/"B" fallback dataset labels). Put new user-facing text
  here rather than inlining it in a `.svelte` file or another `src/lib/*.js`
  file, so copy can be edited in one place without hunting through markup.
- `src/lib/text.js` — the shared `pluralize(n, word, suffix)` helper used by
  `strings.js` template functions to dedupe singular/plural suffix logic.
- `src/components/` — UI: file upload → column mapping → tree panel per
  system (with progress bar, sample-data shortcuts, grey-out of mapped
  entries, an editable dataset name used in export filenames), the mapping
  bar (build a group from the current selections), and the mapping list
  (named groups, drag-and-drop, removable bubbles, name/note kept as compact
  static text behind an edit toggle rather than always-editable fields).
- `tests/logic.test.mjs` — plain-Node tests for the pure logic in `src/lib/*`
  (no browser/DOM). Run with `npm run test:logic`.
- `tests/crosswalk.spec.js` — Playwright end-to-end test driving the real UI.
  Run with `npm run test:e2e` (or `npm test` for both suites).

## Running things

```bash
npm install
npm run dev          # http://localhost:5173
npm run build         # outputs static site to dist/
npm test              # logic tests + Playwright e2e
```

`npm`/`node` may need `nvm use` first if not already on PATH.

## Git workflow

- Never create a git commit without the user's explicit go-ahead for that
  specific commit. A broader request ("merge this in", "clean up X") is not
  itself permission to commit — propose the change, then ask before
  committing, even in contexts (e.g. background/autonomous sessions) where
  the default behavior would be to commit and ship without stopping to ask.

## Conventions

- Don't use git worktrees in this repo — work directly in the main checkout.
  This project has repeatedly ended up with stale, uncommitted worktrees
  (abandoned mid-task, or superseded by changes later merged into `main`
  through a different path) that then need manual reconciliation. Just
  commit to the current branch directly instead.
- No backend and no external network calls — everything must work fully
  offline in the browser. Don't introduce a server dependency.
- Keep `src/lib/*.js` free of Svelte imports/DOM assumptions where possible so
  the logic tests can run under plain Node.
- Rows are expected in top-down document order (a parent row precedes its
  children); hierarchy nesting is derived from a level column (see
  `buildHierarchy` in `src/lib/hierarchy.js`), or auto-detected — check that
  file for the current rules before changing them.
- Only bottom-level (child/leaf) codes are meaningful in an exported crosswalk;
  parent/ancestor codes exist purely to help users navigate and build
  many-to-many mappings quickly. Keep this distinction in mind when touching
  export logic or the mapping data model.
- When changing `src/lib/*.js`, update `tests/logic.test.mjs` alongside it,
  and run `npm run test:logic` before considering a change done. For UI-visible
  changes, also update `tests/crosswalk.spec.js` and run `npm run test:e2e`.
- Testing is not optional and not just for the one thing you touched. Every bug
  fix and every new/changed feature needs a regression test that fails without
  the fix and passes with it — a fix with no test is not done. Before calling
  any change complete, run the *full* suite (`npm test`), not just the file you
  edited: this codebase has repeatedly shipped bugs (bad column-guessing
  heuristics, a hierarchy-building bug that silently misnested codes, a
  mapping-uniqueness check that silently dropped codes instead of blocking the
  selection) that a narrower test run would have missed or that had no test
  coverage at all. When a bug report describes a specific dataset or sequence of
  UI actions, reproduce it first (a quick Node script against `src/lib/*.js`, or
  a Playwright test) before trusting that a fix actually fixes it.
- Always keep `SPEC.md` up to date with the current data model, algorithms,
  and export shape whenever you change behavior that it documents (see
  Documentation map above) — treat a stale `SPEC.md` as an incomplete
  change, not a follow-up. Update `README.md` too if the change affects its
  higher-level feature list or setup/CSV-format instructions.
- Icon buttons: use inline SVGs from the `@material-design-icons/svg` package
  rather than emoji or hand-drawn paths. Import the specific icon with Vite's
  `?raw` suffix (e.g. `import editIcon from
  '@material-design-icons/svg/filled/edit.svg?raw';`) and render it with
  `{@html editIcon}` inside the button; size/color it via
  `.icon-btn :global(svg) { width: …; height: …; fill: currentColor; }`. See
  the rename/note buttons in `MappingList.svelte` and `TreePanel.svelte` for
  the pattern. Plain-text glyphs (e.g. "✕" for remove/close) are unaffected —
  this convention is specifically for edit/action icons that read poorly as a
  single character.
- Hoverable code chips/hints use a custom fast-appearing tooltip (`fastTooltip`
  action + `tooltipState` store in `src/lib/tooltip.js`, rendered by a single
  `<FastTooltip/>` mounted in `App.svelte`, ~150ms delay) instead of the
  native `title` attribute, since the browser's own hover-tooltip delay is too
  slow for quickly scanning many codes or reading a field hint. Reuse
  `fastTooltip` (don't add a native `title` back, and don't reimplement a
  local copy) if you add more hoverable elements elsewhere — see its use in
  `MappingList.svelte` (code bubbles) and `ColumnMapper.svelte` ("?" hints).
