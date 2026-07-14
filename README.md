# Crosswalk Generator

[![Test](https://github.com/staadecker/crosswalk-generator/actions/workflows/test.yml/badge.svg)](https://github.com/staadecker/crosswalk-generator/actions/workflows/test.yml)

This websites lets you build a mapping table (aka. a crosswalk or concordance table) between two hierarchical classification systems. All data stays on your device as processing is done locally, in your browser.

I built this tool to develop a mapping between the EXIOBASEv3 and NAICS 2022 industry classification systems as part of my Master's research at MIT. It was my first project trying out Claude Code. Almost all the code was written by Claude Code.

## License Notice

Copyright 2026 Martin Staadecker

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See the [LICENSE][./LICENSE] file.

## Features

- 📁 **Upload two CSVs** and confirm which columns are *code*, *title*, and optionally
  *level* and *description* — all auto-detected (overridable), including telling a short
  title column apart from a longer description column when a file has both.
- 🌱 **Try with sample data** — one-click shortcut buttons on *both* sides, offering the
  same choice of a few bundled sample datasets (small NAICS/NACE samples, plus a full
  real-world NAICS 2022 file) so either side can load any of them. Picking one builds the
  hierarchy immediately — no column-mapping step to click through.
- ✏️ **Editable dataset names**, via a dedicated rename button in each panel header (always
  visible, not just on hover) — also used to name the exported crosswalk files (e.g.
  `my-naics-to-my-nace-crosswalk-2026-07-14.zip`).
- 🌳 **Collapsible, searchable trees**, with a bigger click target and hover state on the
  expand/collapse arrows. Hovering a node with a description shows it as a tooltip — even a
  mapped/disabled one, since that's still useful and the cursor never changes to a "blocked"
  symbol. Long titles wrap onto further lines instead of being cut off. A search auto-reveals
  matches by expanding their ancestors, but any section can still be collapsed afterwards
  (including one that's part of the current results) — it doesn't spring back open. A section
  also auto-collapses the moment every code beneath it becomes mapped.
- ⚡ **Fast custom tooltips** on a mapping's code bubbles — a short, quick-appearing
  tooltip with the code's title, instead of waiting on the browser's native hover delay.
- 🔢 **Auto-detected level by default** — hierarchy depth is inferred straight from each
  code's own structure (dot-separator count or code length, including NAICS-style
  hyphenated sector-range codes like "48-49"), with parent codes handled one of two ways
  (see [Auto-detected level](#auto-detected-level-default) below): **parent codes already
  included** (each code nests directly under its own matching ancestor row) or
  **auto-generate parent codes** (every code is treated as a child — missing ancestors are
  synthesized, e.g. adding "01" if only "01.a"/"01.b" are present, and a code that collides
  with another code's implied ancestor is disambiguated into a new "\<code\> (group)" node,
  e.g. "20" and "20.w" both present generates "20 (group)" as their shared parent). Codes are
  sorted into their natural position among siblings either way. Switch to an explicit level
  column instead if auto-detection gets a file wrong.
- 🔗 **Grouped many-to-many mappings** — selecting codes on both sides and linking them
  creates a single group (not one row per pair), named from the linked A-side leaf codes
  themselves (semicolon-joined, e.g. `11111;11112`) rather than their titles — the name isn't
  shown or editable in the Mappings pane since it's just those same codes already displayed
  as bubbles. Drag a code from either tree onto an existing group to add it; drag a code
  bubble from one group onto another (in the Mappings pane) to move it there instead of
  copying it; remove a single code from a group via its bubble's "✕"; hover a bubble for a
  fast tooltip showing that code's title. Only leaf (lowest-level) codes are ever stored in a
  mapping — parent codes are purely a navigation/selection convenience, and the UI compacts a
  group's leaves back into a parent code for display whenever every leaf under that parent is
  present.
- ⇄ **Equal vs. approximately-equal** — the two-way arrow between a group's A and B bubbles
  (not a plain "→", since a crosswalk relationship isn't one-directional) is clickable: it
  toggles the group between "equal" (⇄, the default) and "approximately equal" (≈). This is
  exported as the `relationship` column in all three crosswalk files.
- 🖱️ **Hover-highlight** — hovering a code (leaf *or* ancestor) in either tree highlights
  every mapping group it (or any of its descendants) belongs to in the Mappings pane.
- 🎯 **Grayed-out mapped entries** instead of a "hide mapped" toggle. Each parent code shows
  a fraction badge of its mapped vs. total descendant leaves (gray `0/N`, blue partial,
  green when complete), and a leaf shows a green checkmark once mapped. Clicking a node with
  children doesn't select it directly — it selects that node's not-yet-mapped leaves (same
  idea as a per-node "select unmapped" action, but built into the click itself), compacting
  the resulting selection to the topmost fully-unmapped code at each branch and auto-expanding
  the tree so it's actually visible.
- 🔒 **Each code maps once per side** — a leaf code already in a mapping group can't be
  selected for a new group on the same side at all (the tree refuses the click, rather than
  silently dropping it at link time); dragging one onto a *different* existing group is
  still rejected with a message. A prior no-match flag doesn't count as a claim, though — a
  code you later find a real match for is never blocked by its own no-match entry.
- 🧾 **Dense Mappings pane** — a group's name and note stay compact static text/an icon
  button until explicitly opened for editing, so hundreds of rows stay scannable.
- ⚠️ **Replacing a file is a destructive action** — it's styled like the other danger
  buttons and, after confirmation, deletes every mapping that referenced that side (rather
  than leaving orphaned half-mappings behind).
- 📊 **Progress bars** above each tree showing the fraction of codes already mapped, turning
  green once a side reaches 100%.
- ↩️ **Undo/redo** in the toolbar, covering mapping changes (linking, no-match, editing,
  removing) — not tree selections or file uploads, which aren't really "edits" to undo. A
  fresh edit after an undo discards whatever could have been redone, and both are cleared
  by clearing everything or loading a different project.
- 💾 **Auto-save** to local storage; **Save/Load project** as JSON to resume or share.
- ⬇️ **One-click export** — a single button downloads one `.zip` containing all three
  crosswalk representations (see [Crosswalk export](#crosswalk-export) below).
- 🌓 Light/dark theme, keyboard-navigable, responsive.

## CSV format

Each file must contain a **code** column and a **title** column, plus either a **level**
column (integer hierarchy depth) or auto-detected levels (see below). An optional
**description** column can hold longer text shown as a hover tooltip. Column names are
arbitrary — you map them after upload.

Rows must be in top-down order (a parent appears before its children).

### Explicit level column

Level numbers need not start at 1 or be dense; a row's parent is the nearest preceding
row with a smaller level.

```csv
level,code,title
1,11,"Agriculture, Forestry, Fishing and Hunting"
2,111,Crop Production
3,1111,Oilseed and Grain Farming
4,11111,Soybean Farming
```

### Auto-detected level (default)

Skip the level column entirely and let the app infer depth from each code's own shape
(dot-separator count, then code length). Choose one of two parent-code modes:

- **Parent codes already included** — the file already has an explicit row for every
  ancestor level; each code just nests under its own matching ancestor row.
- **Auto-generate parent codes** — every provided code is assumed to be a child/leaf, never
  an implicit parent. A missing ancestor is synthesized as a blank-title row (e.g. adding
  "01" if only "01.a" and "01.b" exist). If an ancestor implied by one code's structure
  coincides with a code that's *also* provided (e.g. both "20" and "20.w" are in the file —
  "20" is "20.w"'s natural parent, but "20" is itself already a real code), that real code
  can't double as the structural parent: instead a new, blank-title "20 (group)" node is
  synthesized, and both "20" and "20.w" nest under it as siblings. This chains for deeper
  collisions (e.g. "1", "1.2", and "1.2.3" all provided produces both a "1 (group)" and a
  "1.2 (group)" node).

The bundled sample datasets already include an explicit row for every ancestor level, so
they use "parent codes already included".

Sample files are in [`samples/`](samples/) (used by the test suite) and
[`public/samples/`](public/samples/) (served to the in-app "Try with sample data"
buttons) — kept in sync as identical copies.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
```

## Test

```bash
npm run test:logic   # plain-Node tests for src/lib/*
npm run test:e2e     # Playwright end-to-end tests
npm test             # both suites
```

## Build

```bash
npm run build      # outputs static site to dist/
npm run preview    # serve the built bundle locally
```

## Deploy to GitHub Pages

1. Push to the `main` branch of a repo named **`crosswalk-generator`** (this matches the
   `base` in [`vite.config.js`](vite.config.js) — change both if you rename the repo).
2. In the repo settings, set **Settings → Pages → Source = GitHub Actions**.
3. The included workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml))
   builds and publishes on every push to `main`.

For a user/organization site or a custom domain served at the root, build with
`BASE_PATH=/ npm run build`.

## Crosswalk export

A single "Export crosswalk (.zip)" button downloads one zip archive containing all three
representations of the current mappings:

- `crosswalk.csv` — full N×N cross-product, one row per A-leaf × B-leaf pair within each
  group:
  `a_code, a_title, b_code, b_title, group_name, relationship, note`, where `relationship`
  is `equal` or `approximate` (blank for a no-match row — see below)
- `a-to-name.csv` — A → group name (many-to-one):
  `a_code, a_title, group_name, relationship`
- `name-to-b.csv` — group name → B (one-to-many):
  `group_name, b_code, b_title, relationship`

A group with no counterpart on one side (a "no match" flag) contributes rows with the
other side's fields left blank in `crosswalk.csv`, and simply doesn't appear in
`a-to-name.csv`/`name-to-b.csv` for its missing side. Marking several codes no-match at
once still creates one such group *per code* (not a single group bundling them together,
since they aren't actually related to each other the way a real many-to-many mapping's
codes are) — each gets its own row in the Mappings pane and its own `group_name` in the
export.

The zip itself is written by a small dependency-free archiver
([`src/lib/zip.js`](src/lib/zip.js), uncompressed/STORE method — plenty for a handful of
CSV files) rather than pulling in an external zip library.

## Tech

Vite + Svelte 5, with [PapaParse](https://www.papaparse.com/) for CSV parsing. No backend.
