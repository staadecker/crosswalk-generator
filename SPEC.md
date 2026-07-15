# Specification

Requirements for the Crosswalk Generator: what the user can do, what the app
must do in response, and what must hold regardless of the path taken to get
there. Written in terms of behavior, not code. Each section ends with a
*Where this lives* pointer naming the responsible source file(s); skip those
if you only care about behavior.

- See `README.md` for the pitch and run/build/deploy steps.
- See `CLAUDE.md` for contributor/agent workflow conventions.
- Update this file whenever you change a behavior it describes. Treat a stale
  spec as an incomplete change.

## Core concepts

- **System** — one of the two classification systems being mapped (A and B).
  - Is either "not loaded" or fully loaded with a name, a hierarchy, and
    (eventually) some mapped codes.
  - A and B have no inherent direction. Either can be "source" or "target";
    nothing may assume one is primary.
- **Code** — one row of a system: an identifier, a short title, an optional
  longer description, and a position in the hierarchy.
- **Hierarchy** — the tree of codes for one system.
  - **Leaf** — a code with no children.
  - **Ancestor** — a code with descendants beneath it.
  - **Parent** — an ancestor of its immediate children.
- **Leaf vs. ancestor code**
  - Only leaf codes are meaningful in an exported crosswalk.
  - Ancestor codes exist purely for navigation and bulk selection: picking an
    ancestor means "all its leaves."
  - The app must always resolve an ancestor down to actual leaves before
    recording or exporting, and must always be able to redisplay a full leaf
    set as a compact ancestor code when every leaf under that ancestor is
    present.
- **Mapping group** — the many-to-many unit the app exists to build: one
  named link between some A-side leaf codes and some B-side leaf codes.
  - Has: a name, an optional free-text note, an "equal" vs. "approximately
    equal" flag, an A-side leaf-code list, and a B-side leaf-code list.
- **No-match** — a group with codes on only one side, asserting "checked, has
  no counterpart in the other system" — distinct from "not yet reviewed." A
  real recorded assertion, but not a mapping.

## Uploading and preparing a system

- The user provides each system by uploading a CSV and completing column
  mapping (below).
- A file is accepted only if its name ends in `.csv` (case-insensitive) —
  checked before parsing, whether the file arrives via the file-picker
  `<input>` or drag-and-drop onto the dropzone (the browser's own
  `accept=".csv"` filter on the `<input>` is not enforced on drop, so this
  check is what actually stops e.g. an accidentally-dropped image). A
  rejected file shows an inline error and never reaches column mapping.
- **Demo-data banner**
  - Appears near the top whenever neither side has data.
  - Offers a one-click "Try with demo data" link that loads a bundled demo
    pair (one classification into A, one into B) into a built hierarchy on
    both sides at once — no column-mapping step, no per-side choice.
  - Has no dismiss control; visibility is purely a function of whether either
    side has data.
    - Disappears the instant one side gets data (upload or demo link).
    - Reappears any time both systems return to empty — including after
      "Replace file…" clears the last loaded side, or after "Restart".

### Required and optional columns

- Every CSV must have a code column and a title column.
- A CSV may optionally have:
  - a description column (shown only as a hover tooltip, never a primary
    label), and
  - either an explicit level column or none (see auto-detection).
- Guessing:
  - The app should guess which uploaded column plays which role, pre-filling a
    choice the user can confirm or override before building.
  - A guess must only pre-fill; it must never block upload.
- The code/title/description column labels are self-explanatory ("Column
  containing the codes", etc.) and carry no "?" hover hint. The "Data includes
  only lowest-level codes (auto-group codes)" checkbox is explained by its own
  always-visible static hint text — see "Level dropdown and lowest-level-codes
  checkbox."

### Column-mapping layout

- Fields are grouped into two labeled sections, in this order:
  1. **Select columns** — code column, title column, description column.
  2. **Configure nesting** — the "Data includes only lowest-level codes
     (auto-group codes)" checkbox, then the level column.
- Nesting comes last since most users leave it on its defaults.

### Level dropdown and lowest-level-codes checkbox

- **Level dropdown** — the one exception to "guess pre-fills a choice."
  - Always starts on "None (auto-detect from code structure)," regardless of
    what the guesser thinks looks level-shaped.
  - The user must deliberately pick a field to switch to an explicit level
    column.
  - Enabled only while the "Data includes only lowest-level codes (auto-group
    codes)" checkbox above it is unchecked; force-reset back to auto-detect
    the moment that checkbox is checked.
    - Rationale: an explicit level column only makes sense when every ancestor
      level already has its own row (see "Explicit level column") — i.e. the
      file is *not* lowest-level-codes-only, which is exactly what the
      checkbox (unchecked) asserts. Auto-generating missing parents is
      supported only for auto-detected levels.
- **"Data includes only lowest-level codes (auto-group codes)" checkbox**
  - Checked by default (i.e. auto-generate parent codes — see auto-detect
    parent handling); most files only contain leaf-level rows.
  - Uncheck it when the file already has an explicit row for every ancestor
    level.
  - Always visible, not only while the level dropdown is on auto-detect.
  - Its explanation is plain, static text next to the checkbox (no "?" hint —
    a hover-only explanation would be redundant with text that's always
    visible) and does not change with the checkbox's state — the behavior it
    describes changes the shape of the resulting tree, so it deserves a
    stable, always-visible explanation rather than one that shifts as the
    user toggles the box.
- No field in the column-mapping step uses a "?" hover hint — the
  code/title/description columns and the level dropdown are self-explanatory
  by label, and the lowest-level-codes checkbox uses its own always-visible
  text (see above). The fast-appearing custom tooltip (`fastTooltip` in
  `src/lib/tooltip.js`) is still used elsewhere, e.g. the mapping list's code
  chips (see "Editing an existing mapping").

### Column-guessing heuristics

- **Code** — the column whose values are short and highly unique across the
  file, favoring a column literally named like "code" or a known
  classification system.
- **Title** — whichever remaining column is clearly a short label by name
  (e.g. "title", "name", "label").
  - Only if no column name looks label-like should it fall back to "the
    longest remaining text column."
- **Description** — the longest remaining text column, but only once it is at
  least plausibly long-form. A short, unrelated column must never be guessed
  as description merely for being the only thing left.
- **Title and description must be resolved together, not independently.** A
  file with both a short title-ish column and a long description-ish column
  must not have the longer column mistaken for the title.

### Row order

- A file's rows must be in top-down order — a parent row precedes its
  children.
- The app need not validate or repair misordered input; behavior on
  out-of-order rows is undefined and is the user's responsibility to fix
  upstream.

### Explicit level column

- Values are integers giving each row's hierarchy depth.
- Levels need not start at 1 or be sequential (e.g. 1, 2, 4 is fine): a row's
  parent is "the nearest earlier row with a smaller level," not a fixed
  numeric relationship.
- Skip a row with a warning (never silently, never crashing) when it has:
  - a missing or non-numeric level,
  - a missing code, or
  - a code duplicating an already-seen code.
- If a file produces no root-level rows, surface that as a warning (usually
  means the wrong column was picked).

### Auto-detected level

- When no level column is picked, depth is inferred purely from each code's
  shape, supporting (without the user declaring the convention):
  - **Dot-separated** codes (e.g. `01` → `01.1` → `01.11`): depth increases
    with segment count.
  - **Length-based** codes (e.g. `11` → `111` → `1111`): depth increases with
    digit count.
    - A NAICS-style hyphenated sector-range code such as `48-49` must sit at
      the same depth as plain two-digit codes like `11`/`21`, not deeper just
      because its written form is longer.
  - **Mixed conventions** within one file (e.g. fixed-width single-letter
    section codes on top, dot-separated or differently-sized levels beneath).
- Dot-separated parent correction (after rough depth assignment):
  - Each dot-separated code's parent should be corrected to the nearest
    *existing* code reachable by trimming trailing segment(s).
    - Two codes can share a shape yet belong at different real depths: `01.11`
      must nest under an existing `01.1` if present, not become a sibling of
      `01`.
    - Codes sharing a shape may still be correct siblings: `13.1` and `13.20`
      can both be direct children of `13`.
  - Codes with no dots are not corrected — no literal substring relationship
    exists to override the shape-based guess.

### Auto-detect parent handling

The user picks one of two modes:

1. **Parent codes already included**
   - The file already has an explicit row for every ancestor level.
   - Each code nests under its matching ancestor row; a code with no matching
     ancestor becomes a root.
2. **Auto-generate parent codes**
   - Every provided code is treated purely as a leaf/child, never assumed to
     double as another code's structural parent.
   - **Missing implied ancestor** — synthesize a blank-title placeholder row
     for it (e.g. produce `01` when only `01.a` and `01.b` are present).
   - **Implied ancestor collides with a real code** (e.g. both `20` and `20.w`
     provided — `20` is `20.w`'s natural parent but also its own real code):
     - Do not repurpose the real code as a structural parent.
     - Synthesize a new blank-title placeholder (e.g. `20 (group)`) as the
       shared parent, with both the real code and whatever needed it as an
       ancestor nested underneath as siblings.
     - Chain correctly for deeper collisions: a colliding code whose own
       natural parent is itself a colliding real code gets its own placeholder
       the same way.
     - Disambiguate a placeholder name that itself collides with an existing
       code (e.g. `20 (group 2)`) rather than silently merging unrelated
       nodes.
   - **Sort position** — every synthesized or reparented code must land in a
     stable, sensible position among its siblings (natural/numeric order), not
     appended after real codes.
   - **Single-child placeholder elision**
     - A blank-title placeholder that would wrap only a single child (real or
       another placeholder) is elided: reparent that child directly onto the
       placeholder's own parent, cascading up if that leaves *that* ancestor
       with only one child too.
     - A placeholder with two or more children is a real grouping and is
       always kept.
     - Exception: `20 (group)`-style collision placeholders are never elided —
       by construction they always have at least two children.

- The bundled demo datasets include an explicit row for every ancestor level,
  so they use mode 1.

*Where this lives: `src/lib/csv.js` (column guessing), `src/lib/hierarchy.js`
(level inference, parent synthesis), `src/components/ColumnMapper.svelte` and
`src/components/SystemPanel.svelte` (upload UI), `src/lib/tooltip.js` and
`src/components/FastTooltip.svelte` (the shared fast-appearing hover tooltip),
`src/App.svelte` (the demo-data banner).*

## Browsing a system

Each loaded system is shown as a collapsible, searchable tree.

- **Default expansion**
  - Top-level codes are expanded by default; deeper levels start collapsed.
  - The user can expand/collapse everything or toggle one section at a time.
  - Default-expand applies exactly once, the moment a hierarchy is first
    built — never again as a side effect of later collapsing.
  - Collapsing every open section (via "Collapse" or by manually toggling the
    last one closed) must leave the tree fully collapsed, not re-expand the
    roots.
- **Search**
  - Typing filters to codes whose code or title contains the query
    (case-insensitive), keeping any ancestor needed to reach a match visible
    even if the ancestor itself doesn't match.
  - Starting or refining a search auto-expands exactly the sections needed to
    reveal current matches — once.
    - After that, the user may manually collapse any section (including one in
      the current results) without the app forcing it back open.
  - A broad early keystroke (e.g. one common letter) may auto-expand a large
    part of the tree for that instant, but that expansion must not persist
    once the query is refined or cleared.
    - Only sections the user explicitly touched stay expanded when the search
      ends; a finished search must never leave the tree permanently more
      exploded than before it began.
- **Auto-collapse on completion**
  - A section should auto-collapse the moment every leaf beneath it becomes
    mapped, filling the tree with "done" signals as work progresses.
  - Only at that transition — not on every re-render — so a user who
    deliberately reopens a complete section isn't fought by the behavior.
- **Mapped-state display** (no separate "hide mapped codes" control)
  - A mapped leaf stays visible but visually de-emphasized with a checkmark.
  - A no-match leaf is marked distinctly from a real mapping.
  - Every ancestor shows a running "N of M mapped" count aggregated from its
    descendants.
  - Each system shows an overall progress bar (mapped leaves out of total
    leaves), turning a distinct "complete" color at 100%.
  - "N of M mapped" is the only total the panel header shows. There is no
    separate raw node/row count anywhere — node count includes never-mappable
    ancestor rows and is a larger number than leaf count; showing both
    previously read as a bug ("it says 1134 codes but only 1047 mapped").
  - An ancestor gets the mapped-leaf de-emphasis only once its *entire*
    subtree is mapped (N of M reaching M of M).
    - A partially-mapped ancestor keeps its normal, undimmed appearance: it is
      still a live, clickable affordance (clicking selects its remaining
      unmapped leaves — see "Selecting codes"), and dimming it would
      misleadingly suggest nothing is left to do.
- **Hover tooltip** — hovering any code shows its longer description if
  provided, else its title. This includes an already-mapped or locked code,
  since the info is still useful and the cursor must never look "blocked."
- **System name** — editable at any time (used in exported filenames) and
  always visible, not only revealed on hover.
- **Replacing a system's file is destructive**
  - Its codes for that side stop meaning anything once the file (and
    hierarchy) is gone.
  - It must delete every mapping group touching that side — not merely blank
    that side on affected groups.
  - It must warn with a count of affected mappings and require confirmation;
    it cannot be undone.

*Where this lives: `src/components/TreePanel.svelte`, `src/lib/hierarchy.js`
(tree-flattening/search logic).*

## Building mappings

### Selecting codes

- Clicking a leaf toggles it in that side's current selection.
- A leaf already in a real mapping group must refuse the click outright rather
  than allow a selection that would silently fail at link time.
- Clicking an ancestor that isn't already selected does not select the
  ancestor directly; instead it:
  - selects every not-yet-mapped leaf beneath it (adding to, not replacing,
    the existing selection),
  - auto-expands the tree so the newly selected codes are visible, and
  - displays the result compacted to the highest fully-selected ancestor(s),
    not a long flat list of leaves.
- An ancestor that *is* currently selected (which can result from compaction)
  must be deselectable by clicking it again, exactly like a leaf — not re-run
  the "select unmapped" behavior.

### Creating a mapping

- With at least one code selected on both sides, the user can link them into
  one new mapping group covering every selected code on each side (expanded to
  full leaf sets) — one group, not one row per pairing.
- **Default name** — the linked A-side leaf codes, semicolon-joined (a code is
  short and stable while a title can be long or missing). The underlying leaf
  set, not the name, defines the mapping.
- An optional note can be attached at creation time.
- **Relationship switch** — before linking, the user picks "equal" (default)
  or "approximately equal" via a two-option switch between the two selection
  lists.
  - The choice applies to the *next* mapping created and persists across links
    until changed.
  - It can still be changed after the fact (see "Editing an existing
    mapping").
- **`G` shortcut** — equivalent to clicking Group, only while that's the live
  action (both sides have a selection). Ignored while focus is in a text input
  (search box, note field, etc.) so it never interrupts typing.

### Flagging no-match

- With a selection on exactly one side (nothing on the other), the user can
  flag those codes as having no counterpart.
- Each flagged code becomes its own separate no-match entry, even if several
  were flagged in one action — codes marked no-match together are not
  necessarily related, so they must never be bundled into one shared group.
  - Exception: when every leaf beneath a common ancestor ends up flagged
    together in one action, those leaves collapse into a single no-match
    entry for that ancestor (the same "fully covered" compaction used for
    mapping-group chips — see "Editing an existing mapping") instead of one
    row per leaf.
  - Two ancestors that are each fully flagged in the same action still
    produce two separate entries — e.g. flagging every leaf under both `07`
    and `08` together gives two rows, one per ancestor, not one merged row;
    they can't be represented by a single shared parent unless every leaf
    under that shared parent was flagged too.

### One real mapping per code, per side

- A leaf may belong to at most one *real* mapping group on a given side.
  - It may appear alongside as many codes as needed on the *other* side of
    that one group (this is what makes the mapping many-to-many).
- Any action that would put a code into a second real group on the same side —
  creating a group, adding by drag-and-drop, or moving between groups — must
  skip that code and report the skip to the user (e.g. a message with a
  count).
  - Never silently drop the whole action; never silently let one group steal a
    code from another.
- A no-match flag does *not* count as a claim on a code:
  - A code already flagged no-match must still be linkable into a real mapping
    later without being blocked by its own no-match entry.
  - Doing so should replace (shrink or remove) the now-contradicted no-match
    entry rather than leaving both around.

### Editing an existing mapping

- Each group's codes are shown as compact chips — one chip can represent an
  entire ancestor's worth of leaves when all of them are present, rather than
  a long flat list.
- **Chip hover** — shows the chip's title via a fast-appearing custom tooltip
  (a short, fixed delay), not the native `title` attribute, whose
  browser-controlled show delay is too slow for quickly scanning many codes.
  - This same tooltip is reused anywhere else that needs a quick hover
    explanation (see `src/lib/tooltip.js`'s `fastTooltip` action).
  - The tooltip always stays fully within the viewport: it clamps
    horizontally instead of overflowing past the left/right edge, and flips
    to appear below its anchor instead of above when there isn't enough room
    above (e.g. an anchor near the top of the page).
- **Drag onto a group's side** adds the code to that group (subject to the
  one-real-mapping-per-side rule).
- **Drag a chip between groups' same side** moves it (not duplicate), and that
  move must never be treated as a conflict with the group it's leaving.
- **Removing a chip** removes every leaf it represents; a group with no codes
  left on either side disappears entirely.
- **Relationship toggle** — `=` (equal) ⇄ `≈` (approximately equal) via a
  single click on the glyph, matching the creation-time switch so the two read
  as one concept.
- **Note** — editable at any time but stays compact, static text until the
  user opens it for editing (a project can have hundreds of rows; always-open
  fields would make the list unscannable).

### Cross-panel highlighting

- Hovering any code (leaf or ancestor) highlights every mapping group touching
  it in the mapping list — for an ancestor, every group touching any of its
  leaf descendants.
- Highlighting is paired with scrolling the row into view (rows are often off
  screen with hundreds of mappings) — but only just enough to make it visible,
  never re-centering a row already on screen.
- Within a highlighted row, the specific bubble the hovered code falls under
  (not every bubble in the row) gets its own more prominent highlight, using
  the same leaf-overlap check as the row-level highlight, scoped to that
  bubble's leaf set.
- **Reverse direction** — clicking a code chip in the mapping list reveals
  that code in its own tree: expand any collapsed ancestor needed to reach it,
  scroll to it, and flash it briefly.

*Where this lives: `src/lib/stores.js` (mapping mutations, uniqueness rule,
focus-request store for click-to-reveal), `src/components/MappingBar.svelte`
(creating mappings), `src/components/MappingList.svelte` (editing, hover-driven
scroll, click-to-reveal), `src/components/TreePanel.svelte` (expand/scroll/flash
on a reveal request).*

## Undo and redo

- Undo/redo covers mapping edits only — creating, editing, or removing
  mappings and no-match flags.
  - It does not cover tree selections, hover state, or file uploads.
- Undo steps back through mapping-state history one action at a time; redo
  steps forward.
- Redo is available only until the next new edit, at which point the redo
  stack is discarded (a fresh edit after undo must never leave a dangling,
  inconsistent redo option).
- History must be fully cleared — not merely emptied by undoing through it —
  whenever the mappings are replaced wholesale rather than incrementally
  edited (clearing everything, or loading a different saved project), since
  undoing into an unrelated prior project would be confusing.

*Where this lives: `src/lib/stores.js`, `src/components/Toolbar.svelte`.*

## Persistence

The app must work with zero setup and never lose work silently.

- **Auto-save** — every change to either system, the mapping list, or the
  current selections should be auto-saved to local storage shortly after it
  happens (a short debounce is fine).
  - A save still pending when the tab is about to close or background must be
    flushed immediately, not lost to the debounce window.
- **Auto-restore** — re-opening the app restores the most recently saved state
  automatically, with no explicit "restore" action.
- **What is saved per system** — only the raw uploaded rows and column choices.
  The derived hierarchy is not persisted; it is rebuilt deterministically from
  rows and column choices.
- **Project file** — the user can explicitly save the full current state (both
  systems, every mapping, current selections) as a downloadable file, and load
  one back to fully replace the current state (including resetting undo/redo
  history, per the rule above).
  - This is the mechanism for resuming on another device or sharing
    in-progress work, independent of local-storage auto-save.

*Where this lives: `src/lib/stores.js`.*

## Exporting the crosswalk

- A single export action produces one downloadable CSV. The user must never
  choose a format up front or trigger multiple downloads.
- **Citation-agreement popup**
  - Clicking the toolbar's export button never downloads anything by itself;
    it first opens a citation-agreement popup (crediting Crosswalk
    Generator/its license) with its own "Export" button.
  - That button is disabled until the user checks an explicit "I agree to
    credit…" checkbox.
  - Only confirming the popup triggers the download.
  - Canceling (its Cancel button, Escape, or its backdrop) closes it without
    downloading.
- **Row shape** — one row *per code*, not per A×B pairing.
  - Every group contributes one row for each A-side leaf and one row for each
    B-side leaf, all sharing that group's number.
  - A group linking 2 A-codes to 3 B-codes produces 5 rows, not a 6-row
    cross-product.
- **Columns**
  - `group_number` — sequential, starting at 1 in group order (not derived
    from the group's name or codes).
  - `system` — literally "A" or "B", regardless of what either system was
    named.
  - `system_name` — the owning system's own name (falling back to "A"/"B" if
    never set).
  - `code`, `title`, `description` — the code's own fields from its system's
    hierarchy (`description` blank if the system has no description column).
  - `relationship` — "equal" or "approximate", repeated on every row of the
    group; blank for a no-match entry (nothing to qualify).
  - `note` — the group's free-text note, repeated on every row of the group.
- A no-match entry still gets its own group number and contributes rows only
  for whichever side has codes.
- **Filename** — reflects both systems' names (falling back to generic labels
  if never set) and the export date, so exports over time or across dataset
  pairs don't collide or need manual renaming.

*Where this lives: `src/lib/crosswalk.js`, `src/components/Toolbar.svelte`.*

## Global actions

- **Undo/redo controls** must always reflect whether anything is actually
  available — never enabled with nothing to do, never disabled while a real
  action exists.
- **Export** must be disabled when there are no mappings at all.
- **Restart** (clear both systems, every mapping, all selections, and
  undo/redo history) is destructive and irreversible; it must require
  confirmation.
- **Help overlay** — a "?" toolbar button opens an overlay concisely
  explaining what the tool does, the upload → select → group → export flow,
  and a short list of keyboard shortcuts (currently just `G` for Group).
  - Closes via its close button, Escape, or its backdrop.
  - While open, the `G` shortcut is suppressed (checked via a shared
    `helpOpen` store) so a keypress meant to dismiss/read the overlay can never
    create a mapping behind it.

*Where this lives: `src/components/Toolbar.svelte` (undo/redo, export, project
save/load, restart, help overlay), `src/lib/stores.js` (the `helpOpen` store
checked by the Group shortcut).*

## Explicit non-goals

- **No backend, no network calls** of any kind — the app must work fully
  offline in the browser, with no server-side dependency for any feature.
- **No inherent directionality** between the two systems — every behavior must
  work the same regardless of which real-world classification is loaded as "A"
  vs. "B."
- **No required understanding of the data model** (leaf vs. ancestor codes,
  compaction, etc.) to use the app correctly — that distinction must be
  handled transparently by selection/linking/display behavior, not exposed as
  something the user manages.
