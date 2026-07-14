# Crosswalk Generator

[![Test](https://github.com/staadecker/crosswalk-generator/actions/workflows/test.yml/badge.svg)](https://github.com/staadecker/crosswalk-generator/actions/workflows/test.yml)

This websites lets you build a mapping table (aka. a crosswalk or concordance table) between two hierarchical classification systems. All data stays on your device as processing is done locally, in your browser.

I built this tool to develop a mapping between the EXIOBASEv3 and NAICS 2022 industry classification systems as part of my Master's research at MIT. It was my first project trying out Claude Code. Almost all the code was written by Claude Code.

For a detailed description of how the app works internally (data model, hierarchy-building algorithm, export format, UI behavior), see [`SPEC.md`](SPEC.md). This README covers what the app does and how to run it; `SPEC.md` covers exactly how.

## License Notice

Copyright 2026 Martin Staadecker

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See the [LICENSE][./LICENSE] file.

## What it does

- Upload two CSVs (or try bundled sample datasets) and confirm which columns hold the code, title, and optionally level/description — columns are auto-detected but overridable.
- Browse each system as a collapsible, searchable tree, with hierarchy depth either taken from an explicit level column or auto-detected from each code's own structure.
- Select codes on both sides and link them into named, many-to-many mapping groups, or flag a code as having no counterpart.
- Track mapping progress per system, with undo/redo over mapping edits.
- Auto-save to local storage; save/load a project as JSON to resume or share.
- Export the full crosswalk as a `.zip` of CSVs in one click.
- Light/dark theme, keyboard-navigable, responsive.

## CSV format

Each file must contain a **code** column and a **title** column, plus either a **level**
column (integer hierarchy depth) or auto-detected levels. An optional
**description** column can hold longer text shown as a hover tooltip. Column names are
arbitrary — you map them after upload. Rows must be in top-down order (a parent appears
before its children).

See [`SPEC.md`](SPEC.md#uploading-and-preparing-a-system) for exactly how level
columns and auto-detection (including NAICS-style hyphenated sector-range codes and
missing/colliding parent synthesis) are interpreted.

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

A single "Export crosswalk (.zip)" button downloads one zip archive containing three
CSV representations of the current mappings (full N×N cross-product, plus two
normalized A→name / name→B files). See [`SPEC.md`](SPEC.md#exporting-the-crosswalk)
for the exact row/column shape of each file.

## Tech

Vite + Svelte 5, with [PapaParse](https://www.papaparse.com/) for CSV parsing. No backend.
