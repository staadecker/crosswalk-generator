# Crosswalk Generator

A lightweight, **fully client-side** web app for building a many-to-many **crosswalk**
between two hierarchical classification systems (e.g. **NAICS ↔ NACE**). Upload two CSV
files (or try the bundled sample datasets), browse each system as a searchable tree, and
group codes together into named many-to-many mappings. Everything runs in your browser —
no server, and your data never leaves your machine.

The two systems are symmetric — there's no inherent "source" or "target" — so the app
refers to them as **A** and **B** (or by whatever name you give each dataset) throughout.

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
  expand/collapse arrows. Hovering a node with a description shows it as a tooltip.
- ⚡ **Fast custom tooltips** on a mapping's code bubbles — a short, quick-appearing
  tooltip with the code's title, instead of waiting on the browser's native hover delay.
- 🔢 **Auto-detected level by default** — hierarchy depth is inferred straight from each
  code's own structure (dot-separator count or code length, including NAICS-style
  hyphenated sector-range codes like "48-49"), with missing parent codes synthesized
  automatically (e.g. adding "01" if only "01.a"/"01.b" are present) and sorted into their
  natural position among siblings. Switch to an explicit level column instead if
  auto-detection gets a file wrong.
- 🔗 **Grouped many-to-many mappings** — selecting codes on both sides and linking them
  creates a single named group (not one row per pair), defaulting to a name built from the
  linked A-side leaf codes themselves (semicolon-joined, e.g. `11111;11112`) rather than
  their titles — rename it any time. Drag a code from either tree onto an existing group to
  add it; drag a code bubble from one group onto another (in the Mappings pane) to move it
  there instead of copying it; remove a single code from a group via its bubble's "✕". Only
  leaf (lowest-level) codes are ever stored in a mapping — parent codes are purely a
  navigation/selection convenience, and the UI compacts a group's leaves back into a parent
  code for display whenever every leaf under that parent is present.
- 🖱️ **Hover-highlight** — hovering a code (leaf *or* ancestor) in either tree highlights
  every mapping group it (or any of its descendants) belongs to in the Mappings pane.
- 🎯 **Grayed-out mapped entries** instead of a "hide mapped" toggle, plus a per-node
  "select unmapped" action that compacts the resulting selection to the topmost
  fully-unmapped code at each branch and auto-expands the tree so it's actually visible.
- 🔒 **Optional "map each code once"** constraint — when enabled, a leaf code already in a
  mapping group can't be selected for a new group on the same side at all (the tree greys
  it out further and refuses the click, rather than silently dropping it at link time);
  dragging one onto a *different* existing group is still rejected with a message.
- 🧾 **Dense Mappings pane** — a group's name and note stay compact static text/an icon
  button until explicitly opened for editing, so hundreds of rows stay scannable.
- ⚠️ **Replacing a file is a destructive action** — it's styled like the other danger
  buttons and, after confirmation, deletes every mapping that referenced that side (rather
  than leaving orphaned half-mappings behind).
- 📊 **Progress bars** above each tree showing the fraction of codes already mapped.
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
(dot-separator count, then code length). "Automatically create missing parent codes" is on
by default, synthesizing any implied ancestor code that isn't itself present in the file
(e.g. adding a blank-title "01" row if only "01.a" and "01.b" exist).

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
  `a_code, a_title, b_code, b_title, group_name, note`
- `a-to-name.csv` — A → group name (many-to-one):
  `a_code, a_title, group_name`
- `name-to-b.csv` — group name → B (one-to-many):
  `group_name, b_code, b_title`

A group with no counterpart on one side (a "no match" flag) contributes rows with the
other side's fields left blank in `crosswalk.csv`, and simply doesn't appear in
`a-to-name.csv`/`name-to-b.csv` for its missing side.

The zip itself is written by a small dependency-free archiver
([`src/lib/zip.js`](src/lib/zip.js), uncompressed/STORE method — plenty for a handful of
CSV files) rather than pulling in an external zip library.

## Tech

Vite + Svelte 5, with [PapaParse](https://www.papaparse.com/) for CSV parsing. No backend.
