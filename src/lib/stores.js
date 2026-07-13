import { writable, derived, get } from 'svelte/store';
import { buildHierarchy } from './hierarchy.js';

const STORAGE_KEY = 'crosswalk-generator:v1';

/**
 * SKOS-inspired relationship types. `source` = left system, `target` = right.
 * `inverse` documents how the relation reads from the target's perspective and
 * is used when displaying/exporting from either direction.
 */
export const RELATIONS = [
  { value: 'exact', label: 'Exact match', symbol: '=', inverse: 'exact' },
  { value: 'broader', label: 'Broader than target', symbol: '⊃', inverse: 'narrower' },
  { value: 'narrower', label: 'Narrower than target', symbol: '⊂', inverse: 'broader' },
  { value: 'close', label: 'Close match', symbol: '≈', inverse: 'close' },
  { value: 'related', label: 'Related', symbol: '~', inverse: 'related' },
];

export const DEFAULT_RELATION = 'exact';

export function relationMeta(value) {
  return RELATIONS.find((r) => r.value === value) ?? RELATIONS[0];
}

/**
 * A "system" holds the uploaded rows plus the derived tree.
 * Shape: { name, colMap: {level,code,description}, rows, tree } | null
 */
export const systemA = writable(null);
export const systemB = writable(null);

/**
 * Mappings: array of { id, sourceCode, targetCode, relation, note }.
 * sourceCode belongs to systemA, targetCode to systemB.
 */
export const mappings = writable([]);

/** Currently selected code in each tree (or null). */
export const selectionA = writable(null);
export const selectionB = writable(null);

let nextId = 1;
export function newMappingId() {
  return `m${Date.now().toString(36)}-${(nextId++).toString(36)}`;
}

/**
 * Construct a system object from parsed rows + column mapping.
 */
export function makeSystem(name, rows, colMap) {
  const tree = buildHierarchy(rows, colMap);
  return { name, colMap, rows, tree };
}

/** Per-code mapping counts, keyed separately for source (A) and target (B). */
export const mappingCounts = derived(mappings, ($mappings) => {
  const source = new Map();
  const target = new Map();
  for (const m of $mappings) {
    source.set(m.sourceCode, (source.get(m.sourceCode) ?? 0) + 1);
    target.set(m.targetCode, (target.get(m.targetCode) ?? 0) + 1);
  }
  return { source, target };
});

/** True when a mapping between these two codes already exists (any relation). */
export function mappingExists($mappings, sourceCode, targetCode) {
  return $mappings.some((m) => m.sourceCode === sourceCode && m.targetCode === targetCode);
}

export function addMapping(sourceCode, targetCode, relation, note = '') {
  let added = false;
  mappings.update(($m) => {
    if (mappingExists($m, sourceCode, targetCode)) return $m;
    added = true;
    return [...$m, { id: newMappingId(), sourceCode, targetCode, relation, note }];
  });
  return added;
}

export function updateMapping(id, patch) {
  mappings.update(($m) => $m.map((m) => (m.id === id ? { ...m, ...patch } : m)));
}

export function removeMapping(id) {
  mappings.update(($m) => $m.filter((m) => m.id !== id));
}

export function clearAll() {
  systemA.set(null);
  systemB.set(null);
  mappings.set([]);
  selectionA.set(null);
  selectionB.set(null);
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
    selectionA: get(selectionA),
    selectionB: get(selectionB),
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
  selectionA.set(data.selectionA ?? null);
  selectionB.set(data.selectionB ?? null);
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
