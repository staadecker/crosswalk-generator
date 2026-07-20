import Papa from 'papaparse';
import { isNoMatch } from './stores.js';

/** Semicolon-join a field of each leaf code's node, in leaf-code order. */
function joinField(leafCodes, byCode, field) {
  return leafCodes.map((code) => byCode.get(code)?.[field] ?? '').join(';');
}

/**
 * One row per mapping group — no cross-product, no per-code row explosion.
 * `system_a`/`system_b` are that group's leaf codes joined with ';'; the
 * `_titles` columns are the corresponding codes' titles, joined with ';' in
 * the same order (so the Nth code in `system_a` lines up with the Nth entry
 * in `system_a_titles`). A no-match group still gets a row, with the empty
 * side's columns blank and a blank `relationship` (there's no correspondence
 * to qualify).
 *
 * @param {object[]} groups  mapping groups: { id, name, aLeafCodes, bLeafCodes, note, approx }
 * @param {object|null} systemA  system A (has tree.byCode)
 * @param {object|null} systemB  system B
 * @returns {Array<object>}
 */
export function buildCrosswalkRows(groups, systemA, systemB) {
  const aByCode = systemA?.tree.byCode ?? new Map();
  const bByCode = systemB?.tree.byCode ?? new Map();
  return groups.map((g) => ({
    system_a: g.aLeafCodes.join(';'),
    system_a_titles: joinField(g.aLeafCodes, aByCode, 'title'),
    system_b: g.bLeafCodes.join(';'),
    system_b_titles: joinField(g.bLeafCodes, bByCode, 'title'),
    relationship: isNoMatch(g) ? '' : g.approx ? 'approximate' : 'equal',
    note: g.note ?? '',
  }));
}

/** Serialize buildCrosswalkRows() output to a CSV string. */
export function crosswalkToCsv(rows) {
  return Papa.unparse(rows, {
    columns: ['system_a', 'system_a_titles', 'system_b', 'system_b_titles', 'relationship', 'note'],
  });
}

/** Trigger a browser download of `content` (text) as `filename`. */
export function downloadFile(filename, content, mime = 'text/plain') {
  downloadBlob(filename, new Blob([content], { type: `${mime};charset=utf-8` }));
}

/** Trigger a browser download of a pre-built `blob` as `filename`. */
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Read a File as text (for project import). */
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
