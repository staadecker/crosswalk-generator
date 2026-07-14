# Crosswalk Generator

A lightweight, **fully client-side** web app for building a many-to-many **crosswalk**
between two hierarchical classification systems (e.g. **NAICS ↔ NACE**). Upload two CSV
files (or try the bundled sample datasets), browse each system as a searchable tree, and
group codes together into named many-to-many mappings. Everything runs in your browser —
no server, and your data never leaves your machine.

## Features

- 📁 **Upload two CSVs** and confirm which columns are *level*, *code*, and *title*
  (auto-detected, overridable), plus an optional *description* column.
- 🌱 **Try with sample data** — one-click shortcut buttons load the bundled NAICS/NACE
  samples so new users can explore without preparing their own files.
- 🌳 **Collapsible, searchable trees**, with a bigger click target and hover state on the
  expand/collapse arrows. Hovering a node with a description shows it as a tooltip.
- 🔢 **Level column or auto-detection** — build the hierarchy from an explicit level
  column, or infer depth straight from each code's structure (dot-separator count or
  code length). Auto mode can also synthesize missing parent codes (e.g. adding "01" if
  only "01.a"/"01.b" are present).
- 🔗 **Grouped many-to-many mappings** — selecting codes on both sides and linking them
  creates a single named group (not one row per pair). Drag a code from either tree onto
  an existing group to add it; remove a single code from a group via its bubble's "✕".
  Only leaf (lowest-level) codes are ever stored in a mapping — parent codes are purely a
  navigation/selection convenience, and the UI compacts a group's leaves back into a
  parent code for display whenever every leaf under that parent is present.
- 🖱️ **Hover-highlight** — hovering a code in either tree highlights any mapping group
  it already belongs to in the Mappings pane.
- 🎯 **Grayed-out mapped entries** instead of a "hide mapped" toggle, plus a per-node
  "select unmapped" action to quickly grab everything still needing attention under a
  parent.
- 🔒 **Optional "map each code once"** constraint — when enabled, a leaf code can't be
  added to two different mapping groups on the same side.
- 📊 **Progress bars** above each tree showing the fraction of codes already mapped.
- 💾 **Auto-save** to local storage; **Save/Load project** as JSON to resume or share.
- ⬇️ **Export the crosswalk to CSV** — either as a single file with the full N×N
  cross-product per group, or as two files (source→group-name many-to-one, and
  group-name→target one-to-many).
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

### Auto-detected level

Skip the level column entirely and let the app infer depth from each code's own shape
(dot-separator count, then code length). Optionally enable "automatically create missing
parent codes" to synthesize any implied ancestor code that isn't itself present in the
file (e.g. adding a blank-title "01" row if only "01.a" and "01.b" exist).

Sample files are in [`samples/`](samples/) (used by the test suite) and
[`public/samples/`](public/samples/) (served to the in-app "Try with sample data"
buttons).

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

**Single-file mode** (one CSV, full N×N cross-product — one row per source-leaf ×
target-leaf pair within each group):

`source_code, source_title, target_code, target_title, group_name, note`

**Split mode** (two CSVs):

- Source → group name (many-to-one): `source_code, source_title, group_name`
- Group name → target (one-to-many): `group_name, target_code, target_title`

A group with no counterpart on one side (a "no match" flag) contributes rows with the
other side's fields left blank in single-file mode, and simply doesn't appear in the file
for its missing side in split mode.

## Tech

Vite + Svelte 5, with [PapaParse](https://www.papaparse.com/) for CSV parsing. No backend.
