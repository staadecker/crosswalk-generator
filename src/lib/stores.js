import { writable, derived, get } from 'svelte/store';
import { buildHierarchy, buildAutoHierarchy } from './hierarchy.js';

const STORAGE_KEY = 'crosswalk-generator:v1';

/**
 * True when a mapping group has no counterpart on one side — either because it
 * was created via markNoMatch(), or because every code was since removed from
 * that side (e.g. via bubble removal). A group needs at least one code on at
 * least one side to exist at all (see removeCodesFromGroup).
 */
export function isNoMatch(g) {
  return g.sourceLeafCodes.length === 0 || g.targetLeafCodes.length === 0;
}

/**
 * A "system" holds the uploaded rows plus the derived tree.
 * Shape: { name, colMap: {level,code,title,description?}, rows, tree } | null
 */
export const systemA = writable(null);
export const systemB = writable(null);

/**
 * Mapping groups: array of
 *   { id, name, sourceLeafCodes: string[], targetLeafCodes: string[], note }.
 * Both code arrays hold only *leaf* codes (see expandToLeaves in hierarchy.js)
 * — parent codes are for navigation only and never stored directly. A group
 * with one side empty (see isNoMatch) represents a "no counterpart" flag
 * rather than a real link.
 */
export const mappings = writable([]);

/** Multi-select: a Set of selected codes per tree. */
export const selectionA = writable(new Set());
export const selectionB = writable(new Set());

/** Code currently hovered in the A/B tree panel (or null), for Mappings-pane highlight. */
export const hoverA = writable(null);
export const hoverB = writable(null);

/**
 * When true, a leaf code may belong to at most one mapping group per side (it
 * can still appear alongside many codes on the *other* side of that one
 * group). Enforced in addGroup/addCodesToGroup, which skip already-claimed
 * codes and report how many were skipped.
 */
export const uniqueMappingOnly = writable(false);

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
 * them. Keyed separately for source (A) and target (B). `noMatchSource(Target)`
 * are the exact leaf codes flagged no-match (not aggregated to ancestors).
 */
export const mappingCounts = derived([mappings, systemA, systemB], ([$mappings, $systemA, $systemB]) => {
  const sourceLeaf = new Map();
  const targetLeaf = new Map();
  const noMatchSource = new Set();
  const noMatchTarget = new Set();
  for (const g of $mappings) {
    const noMatch = isNoMatch(g);
    for (const c of g.sourceLeafCodes) {
      sourceLeaf.set(c, (sourceLeaf.get(c) ?? 0) + 1);
      if (noMatch) noMatchSource.add(c);
    }
    for (const c of g.targetLeafCodes) {
      targetLeaf.set(c, (targetLeaf.get(c) ?? 0) + 1);
      if (noMatch) noMatchTarget.add(c);
    }
  }
  return {
    source: aggregateCounts($systemA?.tree, sourceLeaf),
    target: aggregateCounts($systemB?.tree, targetLeaf),
    noMatchSource,
    noMatchTarget,
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
 * Leaf codes already claimed by some *other* group on the given side — used to
 * enforce uniqueMappingOnly. `excludeGroupId` lets a group check against every
 * other group without flagging its own existing codes as a conflict.
 */
function codesUsedElsewhere($mappings, side, excludeGroupId) {
  const key = side === 'source' ? 'sourceLeafCodes' : 'targetLeafCodes';
  const used = new Set();
  for (const g of $mappings) {
    if (g.id === excludeGroupId) continue;
    for (const c of g[key]) used.add(c);
  }
  return used;
}

/**
 * Create one new mapping group linking sourceLeafCodes × targetLeafCodes (both
 * already expanded to leaf codes — see expandToLeaves). Adding a real mapping
 * for a leaf code drops/shrinks any prior no-match group touching that same
 * leaf code (they're contradictory); a no-match group left empty on both
 * sides is dropped entirely.
 *
 * When uniqueMappingOnly is on, codes already claimed by another group on the
 * same side are skipped rather than added (reported back so the caller can
 * tell the user).
 *
 * @returns {{ skippedSource: string[], skippedTarget: string[] }}
 */
export function addGroup(sourceLeafCodes, targetLeafCodes, name, note = '') {
  let skippedSource = [];
  let skippedTarget = [];
  mappings.update(($m) => {
    let srcCodes = [...new Set(sourceLeafCodes)];
    let tgtCodes = [...new Set(targetLeafCodes)];
    if (get(uniqueMappingOnly)) {
      const usedSrc = codesUsedElsewhere($m, 'source', null);
      const usedTgt = codesUsedElsewhere($m, 'target', null);
      skippedSource = srcCodes.filter((c) => usedSrc.has(c));
      skippedTarget = tgtCodes.filter((c) => usedTgt.has(c));
      srcCodes = srcCodes.filter((c) => !usedSrc.has(c));
      tgtCodes = tgtCodes.filter((c) => !usedTgt.has(c));
    }
    if (!srcCodes.length && !tgtCodes.length) return $m;
    const srcSet = new Set(srcCodes);
    const tgtSet = new Set(tgtCodes);
    const next = $m
      .map((g) => {
        if (!isNoMatch(g)) return g;
        return {
          ...g,
          sourceLeafCodes: g.sourceLeafCodes.filter((c) => !srcSet.has(c)),
          targetLeafCodes: g.targetLeafCodes.filter((c) => !tgtSet.has(c)),
        };
      })
      .filter((g) => g.sourceLeafCodes.length || g.targetLeafCodes.length);
    const group = {
      id: newMappingId(),
      name,
      sourceLeafCodes: srcCodes,
      targetLeafCodes: tgtCodes,
      note,
    };
    return [...next, group];
  });
  return { skippedSource, skippedTarget };
}

/**
 * Flag leaf codes on one side as having no counterpart, as a single new group.
 * Skips codes that already belong to any existing group (real or no-match).
 * @param {'source'|'target'} side
 * @returns {{ added: number, skipped: number }}
 */
export function markNoMatch(side, leafCodes, name, note = '') {
  let added = 0;
  let skipped = 0;
  mappings.update(($m) => {
    const eligible = [];
    for (const code of leafCodes) {
      const already = $m.some((g) => g.sourceLeafCodes.includes(code) || g.targetLeafCodes.includes(code));
      if (already) {
        skipped++;
        continue;
      }
      eligible.push(code);
      added++;
    }
    if (!eligible.length) return $m;
    const group = {
      id: newMappingId(),
      name: name ?? (eligible.length === 1 ? eligible[0] : `${eligible.length} codes`),
      sourceLeafCodes: side === 'source' ? eligible : [],
      targetLeafCodes: side === 'target' ? eligible : [],
      note,
    };
    return [...$m, group];
  });
  return { added, skipped };
}

export function renameGroup(id, name) {
  mappings.update(($m) => $m.map((g) => (g.id === id ? { ...g, name } : g)));
}

export function updateGroupNote(id, note) {
  mappings.update(($m) => $m.map((g) => (g.id === id ? { ...g, note } : g)));
}

/**
 * Add leaf codes to an existing group's source or target side (e.g.
 * drag-and-drop). When uniqueMappingOnly is on, codes already claimed by a
 * *different* group on that same side are skipped (adding a code already in
 * *this* group is always a harmless no-op, not a conflict).
 *
 * @returns {{ skipped: string[] }}
 */
export function addCodesToGroup(id, side, leafCodes) {
  const key = side === 'source' ? 'sourceLeafCodes' : 'targetLeafCodes';
  let skipped = [];
  mappings.update(($m) => {
    const used = get(uniqueMappingOnly) ? codesUsedElsewhere($m, side, id) : null;
    return $m.map((g) => {
      if (g.id !== id) return g;
      const set = new Set(g[key]);
      for (const c of leafCodes) {
        if (used && used.has(c)) {
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
 * Remove specific leaf codes from one side of a group (e.g. clicking a bubble's
 * ✕ — a compacted/parent bubble removes its whole underlying leaf set, a plain
 * leaf bubble removes just that one code). The whole group is dropped once it
 * has no codes left on either side.
 */
export function removeCodesFromGroup(id, side, leafCodes) {
  const toRemove = new Set(leafCodes);
  const key = side === 'source' ? 'sourceLeafCodes' : 'targetLeafCodes';
  mappings.update(($m) => {
    const next = [];
    for (const g of $m) {
      if (g.id !== id) {
        next.push(g);
        continue;
      }
      const updated = { ...g, [key]: g[key].filter((c) => !toRemove.has(c)) };
      if (updated.sourceLeafCodes.length || updated.targetLeafCodes.length) next.push(updated);
    }
    return next;
  });
}

export function removeMapping(id) {
  mappings.update(($m) => $m.filter((m) => m.id !== id));
}

export function clearAll() {
  systemA.set(null);
  systemB.set(null);
  mappings.set([]);
  selectionA.set(new Set());
  selectionB.set(new Set());
  hoverA.set(null);
  hoverB.set(null);
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
    uniqueMappingOnly: get(uniqueMappingOnly),
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
  uniqueMappingOnly.set(!!data.uniqueMappingOnly);
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
  [systemA, systemB, mappings, selectionA, selectionB, uniqueMappingOnly].forEach((s) => s.subscribe(scheduleSave));

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
