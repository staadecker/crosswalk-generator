# Crosswalk Generator

A lightweight, **fully client-side** web app for building a many-to-many **crosswalk**
between two hierarchical classification systems (e.g. **NAICS ↔ NACE**). Upload two CSV
files, browse each system as a searchable tree, and link codes with typed relationships.
Everything runs in your browser — no server, and your data never leaves your machine.

## Features

- 📁 **Upload two CSVs** and confirm which columns are *level*, *code*, and *description*
  (auto-detected, overridable).
- 🌳 **Collapsible, searchable trees** built from an explicit hierarchy-level column.
- 🔗 **Many-to-many mapping** with SKOS-style typed relationships: exact, broader,
  narrower, close, related.
- 🏷️ **Mapped-count badges** on tree nodes and a filterable mapping list.
- 💾 **Auto-save** to local storage; **Save/Load project** as JSON to resume or share.
- ⬇️ **Export the crosswalk to CSV**.
- 🌓 Light/dark theme, keyboard-navigable, responsive.

## CSV format

Each file must contain a **level** column (integer hierarchy depth), a **code** column,
and a **description** column. Column names are arbitrary — you map them after upload.
Rows must be in top-down order (a parent appears before its children). Level numbers need
not start at 1 or be dense; a row's parent is the nearest preceding row with a smaller
level.

```csv
level,code,description
1,11,"Agriculture, Forestry, Fishing and Hunting"
2,111,Crop Production
3,1111,Oilseed and Grain Farming
4,11111,Soybean Farming
```

Sample files are in [`samples/`](samples/).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
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

## Crosswalk export columns

`source_code, source_description, target_code, target_description, relation, relation_label, note`

Relationships read source-relative (System A → System B): `broader` means the source code
is broader than the target.

## Tech

Vite + Svelte, with [PapaParse](https://www.papaparse.com/) for CSV parsing. No backend.
