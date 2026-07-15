import { writable, derived, get } from 'svelte/store';
import { buildHierarchy, buildAutoHierarchy, compactCodes } from './hierarchy.js';

const STORAGE_KEY = 'crosswalk-generator:v2';

/**
 * True when a mapping group has no counterpart on one side — either because it
 * was created via markNoMatch(), or because every code was since removed from
 * that side (e.g. via bubble removal). A group needs at least one code on at
 * least one side to exist at all (see removeCodesFromGroup).
 */
export function isNoMatch(g) {
  return g.aLeafCodes.length === 0 || g.bLeafCodes.length === 0;
}

/**
 * A "system" holds the uploaded rows plus the derived tree.
 * Shape: { name, colMap: {level,code,title,description?}, rows, tree } | null
 */
export const systemA = writable(null);
export const systemB = writable(null);

/**
 * Mapping groups: array of
 *   { id, name, aLeafCodes: string[], bLeafCodes: string[], note }.
 * Both code arrays hold only *leaf* codes (see expandToLeaves in hierarchy.js)
 * — parent codes are for navigation only and never stored directly. A group
 * with one side empty (see isNoMatch) represents a "no counterpart" flag
 * rather than a real link.
 */
export const mappings = writable([]);

/**
 * Undo/redo over `mappings` only (not selections/hover, which are transient UI
 * state, not edits worth undoing). Every mutator in this file replaces the
 * array immutably (map/filter/spread), so a *reference* change always means a
 * real edit happened — that's what drives recording history here, without
 * needing every mutator to opt in individually. `mappingsHistory`/
 * `mappingsFuture` hold past/future array states (most-recent last) purely so
 * the toolbar can reactively enable/disable the undo/redo buttons.
 */
export const mappingsHistory = writable([]);
export const mappingsFuture = writable([]);
export const canUndoMappings = derived(mappingsHistory, (h) => h.length > 0);
export const canRedoMappings = derived(mappingsFuture, (f) => f.length > 0);

let lastMappingsValue = get(mappings);
let applyingHistory = false; // true while undo/redo itself is setting `mappings`, so that doesn't get recorded as a new action
mappings.subscribe(($m) => {
  if (applyingHistory) {
    lastMappingsValue = $m;
    return;
  }
  if ($m !== lastMappingsValue) {
    mappingsHistory.update((h) => [...h, lastMappingsValue]);
    mappingsFuture.set([]); // a fresh edit invalidates whatever could have been redone
    lastMappingsValue = $m;
  }
});

export function undoMappings() {
  const h = get(mappingsHistory);
  if (!h.length) return;
  const prev = h[h.length - 1];
  mappingsHistory.set(h.slice(0, -1));
  mappingsFuture.update((f) => [...f, lastMappingsValue]);
  applyingHistory = true;
  mappings.set(prev);
  applyingHistory = false;
  lastMappingsValue = prev;
}

export function redoMappings() {
  const f = get(mappingsFuture);
  if (!f.length) return;
  const next = f[f.length - 1];
  mappingsFuture.set(f.slice(0, -1));
  mappingsHistory.update((h) => [...h, lastMappingsValue]);
  applyingHistory = true;
  mappings.set(next);
  applyingHistory = false;
  lastMappingsValue = next;
}

/**
 * Wipe undo/redo history — used whenever `mappings` is replaced wholesale by
 * something other than an incremental edit (clearing everything, or loading a
 * different project entirely), since "undoing" back into an unrelated, prior
 * project's mappings would be more confusing than useful.
 */
function resetMappingsHistory() {
  mappingsHistory.set([]);
  mappingsFuture.set([]);
}

/** Multi-select: a Set of selected codes per tree. */
export const selectionA = writable(new Set());
export const selectionB = writable(new Set());

/** Code currently hovered in the A/B tree panel (or null), for Mappings-pane highlight. */
export const hoverA = writable(null);
export const hoverB = writable(null);

/**
 * A request to reveal one code in the A/B tree panel: `{ code, ts }` or null.
 * Set (e.g. by clicking a code bubble in the Mappings pane) to have that
 * side's TreePanel expand the code's ancestors, scroll it into view, and
 * flash it. `ts` makes every request a distinct object so clicking the same
 * code twice in a row still re-triggers the effect.
 */
export const focusA = writable(null);
export const focusB = writable(null);

// Whether the help overlay is open — checked by the 'L' shortcut so it can't
// fire invisibly behind the overlay while the user is reading it.
export const helpOpen = writable(false);

// Whether the "try our demo data" banner has been dismissed (manually, or by
// loading data on either side). Lives here rather than as local App.svelte
// state so clearAll() (Restart) can reset it — otherwise a banner dismissed
// earlier in the session would never come back even after Restart empties
// both systems again.
export const demoBannerDismissed = writable(false);

/** Request that a tree panel reveal (expand/scroll/flash) the given code. */
export function focusCode(side, code) {
  (side === 'A' ? focusA : focusB).set({ code, ts: Date.now() });
}

/** Toggle a code in/out of a selection Set store. */
export function toggleSelection(store, code) {
  store.update(($s) => {
    const next = new Set($s);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    return next;
  });
}

/** Empty a selection Set store. */
export function clearSelection(store) {
  store.set(new Set());
}

/** Add several codes to a selection Set store at once (e.g. "select unmapped"). */
export function addToSelection(store, codes) {
  store.update(($s) => {
    const next = new Set($s);
    for (const c of codes) next.add(c);
    return next;
  });
}

let nextId = 1;
export function newMappingId() {
  return `m${Date.now().toString(36)}-${(nextId++).toString(36)}`;
}

/**
 * Build a readable default group name from the (compacted, for brevity) leaf
 * codes on one side, joined with semicolons — reuse the single code if
 * there's just one, else aggregate. Uses codes rather than titles, since a
 * title can be long/absent and a code is always a stable, compact identifier.
 */
export function defaultGroupName(system, leafCodes) {
  const displayCodes = system ? compactCodes(system.tree, leafCodes) : [...leafCodes];
  return displayCodes.join(';');
}

/**
 * Construct a system object from parsed rows + column mapping.
 */
export function makeSystem(name, rows, colMap) {
  const tree = colMap.autoLevel
    ? buildAutoHierarchy(rows, colMap, { synthesizeParents: !!colMap.autoParents })
    : buildHierarchy(rows, colMap);
  return { name, colMap, rows, tree };
}

/**
 * Per-leaf-code mapping "weight" (how many groups touch that leaf), aggregated
 * up the tree so ancestor nodes can show how much mapping activity is beneath
 * them. Keyed separately for A and B. `noMatchA`/`noMatchB` are the exact leaf
 * codes flagged no-match (not aggregated to ancestors).
 */
export const mappingCounts = derived([mappings, systemA, systemB], ([$mappings, $systemA, $systemB]) => {
  const aLeaf = new Map();
  const bLeaf = new Map();
  const noMatchA = new Set();
  const noMatchB = new Set();
  for (const g of $mappings) {
    const noMatch = isNoMatch(g);
    for (const c of g.aLeafCodes) {
      aLeaf.set(c, (aLeaf.get(c) ?? 0) + 1);
      if (noMatch) noMatchA.add(c);
    }
    for (const c of g.bLeafCodes) {
      bLeaf.set(c, (bLeaf.get(c) ?? 0) + 1);
      if (noMatch) noMatchB.add(c);
    }
  }
  return {
    a: aggregateCounts($systemA?.tree, aLeaf),
    b: aggregateCounts($systemB?.tree, bLeaf),
    noMatchA,
    noMatchB,
  };
});

/** Sum a leaf-code -> count map up through the tree, so every node (leaf or ancestor) gets a total. */
function aggregateCounts(tree, leafCountMap) {
  const result = new Map();
  if (!tree) return result;
  const sum = (node) => {
    const children = tree.childrenOf.get(node.code) ?? [];
    let n;
    if (children.length === 0) {
      n = leafCountMap.get(node.code) ?? 0;
    } else {
      n = 0;
      for (const child of children) n += sum(child);
    }
    result.set(node.code, n);
    return n;
  };
  tree.roots.forEach(sum);
  return result;
}

/**
 * Leaf codes already claimed by some *other* group on the given side — a leaf
 * code may belong to at most one mapping group per side (it can still appear
 * alongside many codes on the *other* side of that one group). `excludeGroupId`
 * lets a group check against every other group without flagging its own
 * existing codes as a conflict. A no-match group's codes don't count as
 * "claimed" here — no-match just means "nothing found yet", not a real
 * mapping, so it must never block that same code from getting a real one
 * later (see addGroup's own no-match-shrinking behavior, which relies on
 * being able to add the real mapping in the first place).
 */
function codesUsedElsewhere($mappings, side, excludeGroupId) {
  const key = side === 'A' ? 'aLeafCodes' : 'bLeafCodes';
  const used = new Set();
  for (const g of $mappings) {
    if (g.id === excludeGroupId || isNoMatch(g)) continue;
    for (const c of g[key]) used.add(c);
  }
  return used;
}

/**
 * Create one new mapping group linking aLeafCodes × bLeafCodes (both already
 * expanded to leaf codes — see expandToLeaves). Adding a real mapping for a
 * leaf code drops/shrinks any prior no-match group touching that same leaf
 * code (they're contradictory); a no-match group left empty on both sides is
 * dropped entirely.
 *
 * Codes already claimed by another group on the same side are skipped rather
 * than added (reported back so the caller can tell the user).
 *
 * @returns {{ skippedA: string[], skippedB: string[] }}
 */
export function addGroup(aLeafCodes, bLeafCodes, name, note = '', approx = false) {
  let skippedA = [];
  let skippedB = [];
  mappings.update(($m) => {
    let aCodes = [...new Set(aLeafCodes)];
    let bCodes = [...new Set(bLeafCodes)];
    const usedA = codesUsedElsewhere($m, 'A', null);
    const usedB = codesUsedElsewhere($m, 'B', null);
    skippedA = aCodes.filter((c) => usedA.has(c));
    skippedB = bCodes.filter((c) => usedB.has(c));
    aCodes = aCodes.filter((c) => !usedA.has(c));
    bCodes = bCodes.filter((c) => !usedB.has(c));
    if (!aCodes.length && !bCodes.length) return $m;
    const aSet = new Set(aCodes);
    const bSet = new Set(bCodes);
    const next = $m
      .map((g) => {
        if (!isNoMatch(g)) return g;
        return {
          ...g,
          aLeafCodes: g.aLeafCodes.filter((c) => !aSet.has(c)),
          bLeafCodes: g.bLeafCodes.filter((c) => !bSet.has(c)),
        };
      })
      .filter((g) => g.aLeafCodes.length || g.bLeafCodes.length);
    const group = {
      id: newMappingId(),
      name,
      aLeafCodes: aCodes,
      bLeafCodes: bCodes,
      note,
      approx, // "equal" by default — see toggleApprox for flipping it post-creation
    };
    return [...next, group];
  });
  return { skippedA, skippedB };
}

/**
 * Flag leaf codes on one side as having no counterpart. Each code becomes its
 * *own* one-sided group (not bundled into a single multi-code group) — codes
 * marked no-match in the same click aren't actually related to each other,
 * unlike a real many-to-many mapping, so each gets its own row. Skips codes
 * that already belong to any existing group (real or no-match).
 * @param {'A'|'B'} side
 * @param {string} [note]  applied to every newly-created row
 * @returns {{ added: number, skipped: number }}
 */
export function markNoMatch(side, leafCodes, note = '') {
  let added = 0;
  let skipped = 0;
  mappings.update(($m) => {
    let next = $m;
    for (const code of leafCodes) {
      const already = next.some((g) => g.aLeafCodes.includes(code) || g.bLeafCodes.includes(code));
      if (already) {
        skipped++;
        continue;
      }
      added++;
      next = [
        ...next,
        {
          id: newMappingId(),
          name: code,
          aLeafCodes: side === 'A' ? [code] : [],
          bLeafCodes: side === 'B' ? [code] : [],
          note,
          approx: false,
        },
      ];
    }
    return next;
  });
  return { added, skipped };
}

export function renameGroup(id, name) {
  mappings.update(($m) => $m.map((g) => (g.id === id ? { ...g, name } : g)));
}

/** Toggle a group between "equal" (the default) and "approximately equal". */
export function toggleApprox(id) {
  mappings.update(($m) => $m.map((g) => (g.id === id ? { ...g, approx: !g.approx } : g)));
}

export function updateGroupNote(id, note) {
  mappings.update(($m) => $m.map((g) => (g.id === id ? { ...g, note } : g)));
}

/**
 * Add leaf codes to an existing group's A or B side (e.g. drag-and-drop).
 * Codes already claimed by a *different* group on that same side are skipped
 * (adding a code already in *this* group is always a harmless no-op, not a
 * conflict).
 *
 * @returns {{ skipped: string[] }}
 */
export function addCodesToGroup(id, side, leafCodes) {
  const key = side === 'A' ? 'aLeafCodes' : 'bLeafCodes';
  let skipped = [];
  mappings.update(($m) => {
    const used = codesUsedElsewhere($m, side, id);
    return $m.map((g) => {
      if (g.id !== id) return g;
      const set = new Set(g[key]);
      for (const c of leafCodes) {
        if (used.has(c)) {
          skipped.push(c);
          continue;
        }
        set.add(c);
      }
      return { ...g, [key]: [...set] };
    });
  });
  return { skipped };
}

/**
 * Move leaf codes from one group to another on the same side (e.g. dragging a
 * mapping-pane bubble onto a different group's row). Removing from the source
 * happens before adding to the target so the move itself is never treated as
 * "used elsewhere". A no-op if source and target are the same group.
 * @returns {{ skipped: string[] }}
 */
export function moveCodesToGroup(sourceId, targetId, side, leafCodes) {
  if (sourceId === targetId) return { skipped: [] };
  removeCodesFromGroup(sourceId, side, leafCodes);
  return addCodesToGroup(targetId, side, leafCodes);
}

/**
 * Remove specific leaf codes from one side of a group (e.g. clicking a bubble's
 * ✕ — a compacted/parent bubble removes its whole underlying leaf set, a plain
 * leaf bubble removes just that one code). The whole group is dropped once it
 * has no codes left on either side.
 */
export function removeCodesFromGroup(id, side, leafCodes) {
  const toRemove = new Set(leafCodes);
  const key = side === 'A' ? 'aLeafCodes' : 'bLeafCodes';
  mappings.update(($m) => {
    const next = [];
    for (const g of $m) {
      if (g.id !== id) {
        next.push(g);
        continue;
      }
      const updated = { ...g, [key]: g[key].filter((c) => !toRemove.has(c)) };
      if (updated.aLeafCodes.length || updated.bLeafCodes.length) next.push(updated);
    }
    return next;
  });
}

export function removeMapping(id) {
  mappings.update(($m) => $m.filter((m) => m.id !== id));
}

/**
 * Delete every mapping group that touches the given side at all (not just
 * strip that side's codes) — used when a system's file is replaced, since a
 * group's codes for that side become meaningless once the underlying file
 * (and therefore its codes/tree) is gone. Leaves groups untouched that only
 * ever had codes on the *other* side.
 * @param {'A'|'B'} side
 * @returns {number} how many groups were deleted
 */
export function clearMappingsForSide(side) {
  const key = side === 'A' ? 'aLeafCodes' : 'bLeafCodes';
  let removed = 0;
  mappings.update(($m) => {
    const next = $m.filter((g) => g[key].length === 0);
    removed = $m.length - next.length;
    return next;
  });
  return removed;
}

export function clearAll() {
  systemA.set(null);
  systemB.set(null);
  mappings.set([]);
  selectionA.set(new Set());
  selectionB.set(new Set());
  hoverA.set(null);
  hoverB.set(null);
  resetMappingsHistory();
  demoBannerDismissed.set(false);
}

// ---------------------------------------------------------------------------
// Persistence: debounced autosave to localStorage + rehydrate on load.
// We serialize rows + colMap (not the derived tree) and rebuild the tree.
// ---------------------------------------------------------------------------

function serializeSystem(sys) {
  if (!sys) return null;
  return { name: sys.name, colMap: sys.colMap, rows: sys.rows };
}

function snapshot() {
  return {
    systemA: serializeSystem(get(systemA)),
    systemB: serializeSystem(get(systemB)),
    mappings: get(mappings),
    // Sets aren't JSON-serializable; store selections as arrays.
    selectionA: [...get(selectionA)],
    selectionB: [...get(selectionB)],
  };
}

export function exportProject() {
  return JSON.stringify({ version: 1, ...snapshot() }, null, 2);
}

/** Load a project snapshot (from JSON) into the stores. */
export function loadProject(data) {
  const a = data.systemA ? makeSystem(data.systemA.name, data.systemA.rows, data.systemA.colMap) : null;
  const b = data.systemB ? makeSystem(data.systemB.name, data.systemB.rows, data.systemB.colMap) : null;
  systemA.set(a);
  systemB.set(b);
  mappings.set(Array.isArray(data.mappings) ? data.mappings : []);
  selectionA.set(new Set(Array.isArray(data.selectionA) ? data.selectionA : []));
  selectionB.set(new Set(Array.isArray(data.selectionB) ? data.selectionB : []));
  resetMappingsHistory();
}

let saveTimer = null;

function saveNow() {
  if (typeof localStorage === 'undefined') return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
  } catch (err) {
    // Quota or serialization issues shouldn't crash the app.
    console.warn('Autosave failed:', err);
  }
}

function scheduleSave() {
  if (typeof localStorage === 'undefined') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

/**
 * Rehydrate from localStorage, then subscribe all stores to autosave.
 * Call once at app startup.
 */
export function initPersistence() {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) loadProject(JSON.parse(raw));
    } catch (err) {
      console.warn('Failed to restore saved state:', err);
    }
  }
  [systemA, systemB, mappings, selectionA, selectionB].forEach((s) => s.subscribe(scheduleSave));

  // Flush any pending debounced save before the page is hidden/unloaded so a
  // change made moments before closing or reloading isn't lost.
  if (typeof window !== 'undefined') {
    const flush = () => saveTimer && saveNow();
    window.addEventListener('pagehide', flush);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
}
