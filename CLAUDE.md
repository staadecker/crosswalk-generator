# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

Crosswalk Generator: a fully client-side web app (Vite + Svelte) for building a
many-to-many crosswalk between two hierarchical classification systems (e.g.
NAICS ↔ NACE). Users upload two CSVs, browse each system as a tree, and link
codes together. Everything runs in the browser — no backend, no network calls;
data is auto-saved to `localStorage` and can be exported as JSON (project) or
CSV (crosswalk).

## Svelte version

This app uses **Svelte 5** (runes: `$state`, `$props`, `$derived`, `$effect`,
`$bindable`, and the `onclick`-style event attributes instead of `on:click`).
When adding or editing components, use Svelte 5 idioms, not Svelte 4's
`export let` / `on:event` / reactive `$:` statement syntax. See
https://svelte.dev/llms-small.txt for a condensed reference if unsure.

## Structure

- `src/lib/csv.js` — CSV parsing (PapaParse) + column-guessing heuristics
  (level/code/title; description is never auto-guessed).
- `src/lib/hierarchy.js` — builds a tree from flat rows, either via an
  explicit level column (`buildHierarchy`) or auto-detected levels inferred
  from code structure (`assignAutoLevels` / `buildAutoHierarchy`, with
  optional missing-parent synthesis via `synthesizeMissingParents`);
  `flattenTree` does the depth-first, expand/filter-aware flattening used by
  the tree UI; `expandToLeaves`/`compactCodes`/`leafCodesOf` convert between
  leaf codes (the only codes that matter for export) and their compacted
  parent-code display form.
- `src/lib/stores.js` — Svelte stores holding the two systems, the mapping
  *groups* (many-to-many, leaf-codes-only, one row per group not per pair),
  current selections, hover state (for cross-panel highlight), the
  unique-mapping-once toggle, and current selections; also owns localStorage
  autosave/restore and project export/import (JSON snapshot).
- `src/lib/crosswalk.js` — turns mapping groups into exportable crosswalk
  rows/CSV, in either single-file (N×N) or split (source→name, name→target)
  form.
- `src/components/` — UI: file upload → column mapping → tree panel per
  system (with progress bar, sample-data shortcut, grey-out of mapped
  entries), the mapping bar (build a group from the current selections), and
  the mapping list (named groups, drag-and-drop, removable bubbles).
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

## Conventions

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
- Always keep `README.md` up to date with the current feature set, CSV format,
  and export shape whenever you change behavior that it documents — treat a
  stale README as an incomplete change, not a follow-up.
