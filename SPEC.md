# Specification

This document describes how the Crosswalk Generator app should (and should
not) behave: what a user can do, what the app does in response, and what
must remain true no matter what sequence of actions gets there. It is
written in terms of behavior and outcomes, not code — variable names,
function names, and internal data shapes are deliberately left out of the
main text, except in a short "Where this lives" pointer at the end of each
section, which names the source file(s) responsible so an implementer can
find the code without the description itself becoming implementation
detail. Skip those pointers if you only care about intended behavior.

See `README.md` for the project pitch and how to run/build/deploy the app,
and `CLAUDE.md` for contributor/agent workflow conventions. Update this file
whenever you change a behavior it describes — a stale spec is an incomplete
change.

## Core concepts

- **System**: one of the two classification systems being mapped (called A
  and B). A system is either "not loaded yet" or fully loaded with a name,
  a hierarchy, and (once the app has run for a while) some mapped codes.
  There is no inherent direction between A and B — either can be the
  "source" or "target" depending how the user thinks about it, and nothing
  in the app should assume one is primary.
- **Code**: one row of a system — an identifier, a short title, an optional
  longer description, and a position in that system's hierarchy.
- **Hierarchy**: the tree of codes for one system. Every code has zero or
  more children. A code with no children is a **leaf**; a code with
  children is an **ancestor** (of everything beneath it) and a **parent**
  (of its immediate children).
- **Leaf code vs. ancestor code**: only leaf codes are ever meaningful in an
  exported crosswalk. Ancestor codes exist purely as a navigation and
  bulk-selection convenience — a user can pick an ancestor to mean "all its
  leaves," but the app must always resolve that down to actual leaves
  before recording or exporting a mapping, and must always be able to
  redisplay a full set of leaves as a compact ancestor code again when
  every leaf under that ancestor happens to be selected.
- **Mapping group**: a single named link between some leaf codes on system A
  and some leaf codes on system B — the many-to-many unit the whole app
  exists to build. A group has a name, an optional free-text note, an
  "equal" vs. "approximately equal" relationship flag, and two lists of
  leaf codes (its A-side codes and its B-side codes).
- **No-match**: a group with codes on only one side, meaning "this code was
  checked and found to have no counterpart in the other system," as
  distinct from "not yet reviewed." No-match is a real, recorded assertion,
  but not a mapping.

## Uploading and preparing a system

A user provides a system either by uploading a CSV file or by picking one of
a few bundled sample datasets with one click (the samples skip straight to a
built hierarchy with no column-mapping step, so trying the app never
requires understanding CSV column semantics up front).

**Required and optional columns.** Every CSV must have a code column and a
title column. It may optionally have a description column (shown only as a
hover tooltip, never as a primary label) and either an explicit level column
or no level column at all (see auto-detection below). The app should guess
which uploaded column plays which role and let the user confirm or override
every guess before building the hierarchy; the guess should never block
upload, only pre-fill a choice.

- The code column is guessed as the column whose values are short and
  highly unique across the file, favoring a column literally named
  something like "code" or naming a known classification system.
- The title column is guessed as whichever remaining column is clearly a
  short label by name (e.g. "title", "name", "label"); only if no column
  name looks label-like should the guess fall back to "the longest
  remaining text column."
- The description column, if any, is guessed as the longest remaining text
  column, but only once it is at least plausibly long-form (a short,
  unrelated column should never be guessed as a description merely for
  being the only thing left).
- Title and description guesses must be resolved together, not
  independently: a file with both a short title-ish column and a long
  description-ish column must not have the longer column mistaken for the
  title just because it has more text in it.

**Row order.** A file's rows must be in top-down order — a parent row
appears before its children. The app is not required to validate or repair
misordered input; behavior on out-of-order rows is undefined and is the
user's responsibility to fix upstream.

**Explicit level column.** If the user picks a level column, its values are
integers giving each row's hierarchy depth. Levels do not need to start at 1
or be sequential — a file using only 1, 2, 4 is fine — because a row's
parent is defined as "the nearest earlier row with a smaller level," not by
any fixed numeric relationship between levels. A row with a missing or
non-numeric level, a missing code, or a code that duplicates an
already-seen code should be skipped with a warning shown to the user, never
silently dropped without explanation and never allowed to crash the import.
If a file produces no root-level rows at all, that should also surface as a
warning (it usually means the wrong column was picked).

**Auto-detected level.** If the user does not pick a level column, hierarchy
depth is inferred purely from each code's own shape, supporting (without
requiring the user to declare which convention a file uses):

- Dot-separated codes (e.g. `01` → `01.1` → `01.11`), where depth increases
  with the number of dot-separated segments.
- Length-based codes (e.g. `11` → `111` → `1111`), where depth increases
  with how many digits a code has, including a NAICS-style hyphenated
  sector-range code such as `48-49` — which must be treated as sitting at
  the same depth as plain two-digit sector codes like `11`/`21`, not as a
  deeper code just because its written form is longer.
- Mixed conventions within one file, e.g. a top level with no dots and a
  fixed width (like single-letter section codes) followed by a
  dot-separated or differently-sized level beneath it.

Once a rough depth is assigned this way, every dot-separated code's parent
should additionally be corrected to the nearest *existing* code reachable by
trimming its own trailing segment(s) — because two codes can share the same
"shape" yet actually belong at different real depths (e.g. a code like
`01.11` must nest under an existing `01.1` if one exists, not become a
sibling of `01`), while other codes sharing a shape may still be correctly
siblings despite a visually different trailing segment (e.g. `13.1` and
`13.20` can both be direct children of `13`). Codes with no dots are not
subject to this correction, since there is no literal substring relationship
to use as evidence for a better parent than the shape-based guess already
produced.

**Auto-detect parent handling.** When using auto-detected levels, the user
picks one of two modes:

1. *Parent codes already included* — the file already has an explicit row
   for every ancestor level; each code simply nests under its own matching
   ancestor row, and any code with no matching ancestor becomes a root.
2. *Auto-generate parent codes* — every provided code is treated purely as a
   leaf/child, never assumed to double as another code's structural parent.
   Any ancestor implied by a code's shape that is missing from the file
   entirely gets a blank-title placeholder row synthesized for it (e.g.
   producing a `01` row when only `01.a` and `01.b` are present). If the
   implied ancestor instead coincides with a code that *is* present in the
   file (e.g. both `20` and `20.w` are provided — `20` is `20.w`'s natural
   parent, but `20` is also its own real code that needs a place in the
   tree), the real code must not be silently repurposed as a structural
   parent; instead a new blank-title placeholder such as `20 (group)`
   should be synthesized as the shared parent, with both the real code and
   whatever needed it as an ancestor nested underneath it as siblings. This
   must chain correctly for deeper collisions (a colliding code whose own
   natural parent is itself a colliding real code gets its own placeholder
   the same way), and a placeholder name that itself happens to collide with
   an existing code must be disambiguated (e.g. `20 (group 2)`) rather than
   silently merging two unrelated nodes. Every synthesized or reparented
   code must still end up in a stable, sensible sort position among its
   siblings (natural/numeric order), not just appended after real codes.
   Finally, a blank-title placeholder that would end up wrapping only a
   single child (real or itself another placeholder) is elided rather than
   created: that child is reparented directly onto the placeholder's own
   parent instead, cascading up the chain if that in turn leaves *that*
   ancestor with only one child too. A placeholder with two or more children
   is a real grouping and is always kept — only single-child wrappers add no
   navigational value and are skipped. (`20 (group)`-style collision
   placeholders are never subject to this elision: a collision placeholder
   exists specifically because its own code is needed by another real code
   too, so it always has at least two children by construction.)

The bundled sample datasets already include an explicit row for every
ancestor level, so they use mode 1.

*Where this lives: `src/lib/csv.js` (column guessing), `src/lib/hierarchy.js`
(level inference, parent synthesis), `src/components/ColumnMapper.svelte`
and `src/components/SystemPanel.svelte` (upload/sample UI).*

## Browsing a system

Each loaded system is shown as a collapsible, searchable tree.

- Top-level codes are expanded by default so the tree isn't a wall of
  collapsed roots; deeper levels start collapsed. The user can expand or
  collapse everything, or toggle one section at a time.
- Typing in the search box filters to codes whose code or title contains the
  query (case-insensitive), keeping any ancestor needed to reach a match
  visible even if the ancestor itself doesn't match. Starting or refining a
  search should auto-expand exactly the sections needed to reveal the
  current matches, once — after that, the user must be free to manually
  collapse any section, including one that's currently part of the search
  results, without the app forcing it back open on a later interaction. A
  broad early keystroke (e.g. a single common letter, which can legitimately
  match nearly everything) is expected to auto-expand a large part of the
  tree for that instant, but that expansion must not persist once the query
  is refined or cleared — only sections the user explicitly touched stay
  expanded once the search ends, so a finished search never leaves the tree
  permanently more exploded than it was before that search began.
- A section should automatically collapse itself the moment every leaf
  beneath it becomes mapped, so a tree fills with visual "done" signals as
  work progresses — but only at the moment that transition happens, not
  every time the app re-renders, so a user who deliberately reopens an
  already-complete section (e.g. to double check it) isn't fought by the
  auto-collapse behavior.
- There is no separate "hide mapped codes" control. Instead, a mapped leaf
  stays visible but visually de-emphasized with a checkmark, a no-match leaf
  is visually marked as such distinctly from a real mapping, and every
  ancestor shows a running "N of M mapped" count aggregated from its
  descendants so progress is visible at a glance without hiding anything.
  Each system also shows an overall progress bar (mapped leaves out of
  total leaves for that system), which turns a distinct "complete" color at
  100%. An ancestor only gets the same visual de-emphasis as a mapped leaf
  once its *entire* subtree is mapped (N of M reaching M of M) — a
  partially-mapped ancestor keeps its normal, undimmed appearance, since
  unlike a mapped leaf it is still a live, clickable affordance (clicking it
  selects its remaining unmapped leaves; see "Selecting codes" below), and
  dimming it the same way a "done" code is dimmed would misleadingly suggest
  there's nothing left to do there.
- Hovering any code shows its longer description as a tooltip if one was
  provided, or its title otherwise — including for an already-mapped or
  locked code, since the information is still useful there and the cursor
  should never look "blocked."
- A system's name is editable at any time (used later in exported
  filenames) and always visible, not only revealed on hover.
- Replacing a system's file is destructive: since a mapping's codes for that
  side stop meaning anything once the underlying file (and its hierarchy) is
  gone, doing so must delete every mapping group that touches that side —
  not merely leave that side blank on affected groups — and must warn the
  user with a count of affected mappings and require confirmation before
  proceeding, since it cannot be undone.

*Where this lives: `src/components/TreePanel.svelte`, `src/lib/hierarchy.js`
(the tree-flattening/search logic).*

## Building mappings

**Selecting codes.** Clicking a leaf code in a tree toggles it in that
side's current selection. A leaf that already belongs to a real mapping
group must refuse the click outright rather than allow a selection that
would silently fail later — the user should never be able to build up a
selection that quietly loses codes at link time. Clicking an ancestor code
that isn't already selected does not select that ancestor directly; instead
it selects every not-yet-mapped leaf beneath it (adding to, not replacing,
whatever else is already selected), auto-expanding the tree as needed so the
newly selected codes are actually visible, and displaying the result
compacted to the highest fully-selected ancestor(s) rather than a long flat
list of leaves. An ancestor code that *is* currently selected (which can
happen as a result of that compaction) must be deselectable by clicking it
again, exactly like a leaf, rather than re-running the "select unmapped"
behavior a second time.

**Creating a mapping.** With at least one code selected on both sides, the
user can link them into one new mapping group covering every selected code
on each side (expanded to their full leaf sets) — one single group, not one
row per pairing. The group's name defaults to the linked A-side leaf codes
themselves (semicolon-joined), since a title can be long or missing while a
code is always short and stable, though the underlying leaf set — not the
name — is what actually defines the mapping. An optional note can be
attached to the new group at creation time. Before linking, the user also
picks whether the mapping being created is "equal" (the default) or
"approximately equal" via a two-option switch sitting between the two
selection lists — the choice applies to the *next* mapping created and
persists across links until changed, so a user creating several approximate
mappings in a row doesn't have to reselect it each time; it can still be
changed after the fact (see "Editing an existing mapping" below). Pressing
the `L` key is equivalent to clicking the Link button (only while it's the
live action, i.e. both sides have a selection) — the shortcut is ignored
while focus is in a text input (the search box, a note field, etc.) so it
can never interrupt normal typing.

**Flagging no-match.** With a selection on exactly one side (and nothing
selected on the other), the user can instead flag those codes as having no
counterpart. Each flagged code becomes its own separate no-match entry, even
if several were flagged in the same action — codes marked no-match together
are not necessarily related to each other the way a real many-to-many
mapping's codes are, so they must never be bundled into one shared group.

**One real mapping per code, per side.** A leaf code may belong to at most
one *real* mapping group on a given side, though it may appear alongside as
many codes as needed on the *other* side of that one group (that's what
makes the mapping many-to-many). Any action that would put a code into a
second real group on the same side — creating a group, adding to an
existing group by drag-and-drop, or moving a code between groups — must
instead skip that code and report the skip back to the user (e.g. as a
message with a count), never silently drop the whole action and never
silently let one group steal a code out of another. A no-match flag does
*not* count as a claim on a code for this rule: a code already flagged
no-match must still be linkable into a real mapping later without being
blocked by its own earlier no-match entry, and doing so should replace
(shrink or remove) that now-contradicted no-match entry rather than leaving
both around.

**Editing an existing mapping.** In the list of existing mappings, each
group's codes are shown as compact chips — one chip can represent an entire
ancestor's worth of leaves when every one of them is present in that group,
rather than a long flat list. Dragging a code from a tree onto an existing
group's side adds it to that group (subject to the one-real-mapping-per-side
rule above); dragging a chip from one group onto a different group's same
side moves it there instead of duplicating it, and that move must never
itself be treated as a conflict with the group it's leaving. Removing a chip
removes every leaf code it represents; a group with no codes left on either
side disappears entirely. Each group's relationship can be toggled between
"equal" (shown as `=`) and "approximately equal" (shown as `≈`) with a
single click on that glyph, matching the equal/approx switch used at
creation time so the two controls read as the same concept. A
group's note is editable at any time but should stay compact, static text
until the user explicitly opens it for editing, since a project can have
hundreds of mapping rows and every row being an always-open text field would
make the list unscannable.

**Cross-panel highlighting.** Hovering any code in a tree (leaf or ancestor)
should highlight every mapping group that touches it — including, for an
ancestor, every group touching any of its leaf descendants — in the mapping
list, so a user can quickly see what's already been done for a code they're
looking at. With hundreds of mapping rows the matching row is often off
the visible list, so the highlight is paired with scrolling that row into
view — but only just enough to make it visible (never re-centering a row
that's already on screen, which would be a distracting jump for no reason).

Going the other direction, clicking a code chip in the mapping list reveals
that code in its own tree: any collapsed ancestor needed to reach it is
expanded, the tree scrolls to it, and it flashes briefly so the user's eye
finds it immediately rather than having to scan for it.

*Where this lives: `src/lib/stores.js` (mapping mutations, the uniqueness
rule, and the focus-request store used for the click-to-reveal),
`src/components/MappingBar.svelte` (creating mappings),
`src/components/MappingList.svelte` (editing existing mappings, hover-driven
scroll, click-to-reveal), `src/components/TreePanel.svelte` (expand/scroll/
flash in response to a reveal request).*

## Undo and redo

Undo/redo covers mapping edits only — creating, editing, or removing
mappings and no-match flags — not tree selections, hover state, or file
uploads, none of which are "edits" a user would expect to step back through.
Undoing steps back through the history of mapping states one action at a
time; redoing steps forward again, but only until the next new edit is made,
at which point whatever could have been redone is discarded (a fresh edit
after an undo should never leave a dangling, inconsistent redo option).
History must be fully cleared — not merely emptied by undoing back through
it — whenever the mappings are replaced wholesale rather than incrementally
edited, i.e. when the user clears everything or loads a different saved
project, since "undoing" into an unrelated prior project's mappings would
be confusing rather than useful.

*Where this lives: `src/lib/stores.js`, `src/components/Toolbar.svelte`.*

## Persistence

The app must work with zero setup and never lose work silently:

- Every change to either system, the mapping list, or the current
  selections should be auto-saved to the browser's local storage shortly
  after it happens (a short debounce is fine — the change doesn't need to
  be durable within milliseconds), so a reload or accidental tab close
  doesn't lose work. A save that's still pending when the tab is about to
  close or go into the background must be flushed immediately rather than
  lost to the debounce window.
- Re-opening the app should restore the most recently saved state
  automatically, with no explicit "restore" action required from the user.
- Only the raw uploaded rows and column choices need to be saved per system
  — the derived hierarchy itself does not need to be persisted, since it can
  always be rebuilt deterministically from the rows and column choices.
- The user can also explicitly save the full current state (both systems,
  every mapping, current selections) as a downloadable project file, and
  load such a file back in later to fully replace the current state
  (including resetting undo/redo history, per the rule above) — this is the
  mechanism for resuming work on a different device or sharing in-progress
  work with someone else, independent of the automatic local-storage save.

*Where this lives: `src/lib/stores.js`.*

## Exporting the crosswalk

A single export action produces one downloadable archive containing three
CSV files that together represent the current mappings in different useful
shapes — a user should never have to choose a format up front or trigger
multiple separate downloads:

1. **The full pairwise crosswalk** — one row for every individual A-leaf ×
   B-leaf combination within each group (so a group linking 2 A-codes to 3
   B-codes produces 6 rows), each row carrying both codes' titles, the
   group's name and note, and whether the relationship is "equal" or
   "approximate." A no-match entry has no pairing to produce, so it instead
   contributes one row per flagged code with the other side's fields left
   blank and no relationship value (there is nothing to qualify).
2. **A-to-name** — one row per A-side leaf code mapping it to its group's
   name (many A-codes can point to the same name), for consumers that want
   a simple many-to-one join from A. A no-match entry with only B-side codes
   contributes nothing to this file (it has no A-side code to list); an
   A-side no-match entry does contribute, with a blank relationship.
3. **Name-to-B** — the mirror of the above: one row per B-side leaf code
   mapping it to its group's name, for a one-to-many join into B.

The exported archive's filename should reflect both systems' names (falling
back to generic labels if a name was never set) and the export date, so
multiple exports over time or across dataset pairs don't collide or require
manual renaming.

*Where this lives: `src/lib/crosswalk.js`, `src/lib/zip.js`,
`src/components/Toolbar.svelte`.*

## Global actions

- Undo/redo controls must reflect whether there is actually anything to
  undo/redo at all times — never enabled with nothing to do, never disabled
  while a real action is available.
- The export action should be disabled when there are no mappings at all,
  since there would be nothing meaningful to produce.
- Clearing everything (both systems, every mapping, all selections, and
  undo/redo history) is destructive and irreversible and must require the
  user to confirm before it happens.
- A "?" help button in the toolbar opens an overlay concisely explaining
  what the tool does and the basic upload → select → link → export flow,
  plus a short list of keyboard shortcuts (currently just `L` for Link). The
  overlay closes via its own close button, the Escape key, or clicking its
  backdrop. While it's open, the `L` shortcut is suppressed (checked via a
  shared `helpOpen` store) so a keypress meant to dismiss/read the overlay
  can never silently create a mapping behind it.

*Where this lives: `src/components/Toolbar.svelte` (undo/redo, export,
project save/load, clear, the help overlay), `src/lib/stores.js` (the
`helpOpen` store checked by the Link shortcut).*

## Explicit non-goals

- No backend and no network calls of any kind — the app must work fully
  offline, entirely in the browser, with no server-side dependency
  introduced for any feature.
- No inherent directionality between the two systems — every piece of
  behavior must work the same regardless of which real-world classification
  the user happens to have loaded as "A" vs. "B."
- No feature should require the user to understand the underlying data
  model (leaf vs. ancestor codes, compaction, etc.) to use the app
  correctly — that distinction should be handled transparently by the
  selection/linking/display behavior described above, not exposed as
  something the user has to manage themselves.
