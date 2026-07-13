import Papa from 'papaparse';
import { relationMeta } from './stores.js';

/**
 * Build crosswalk rows joining each mapping to its source/target descriptions.
 *
 * @param {object[]} mappings
 * @param {object|null} systemA  source system (has tree.byCode)
 * @param {object|null} systemB  target system
 * @returns {Array<object>}
 */
export function buildCrosswalkRows(mappings, systemA, systemB) {
  const aByCode = systemA?.tree.byCode ?? new Map();
  const bByCode = systemB?.tree.byCode ?? new Map();
  return mappings.map((m) => ({
    source_code: m.sourceCode,
    source_description: aByCode.get(m.sourceCode)?.description ?? '',
    target_code: m.targetCode,
    target_description: bByCode.get(m.targetCode)?.description ?? '',
    relation: m.relation,
    relation_label: relationMeta(m.relation).label,
    note: m.note ?? '',
  }));
}

/** Serialize crosswalk rows to a CSV string. */
export function crosswalkToCsv(rows) {
  return Papa.unparse(rows, {
    columns: [
      'source_code',
      'source_description',
      'target_code',
      'target_description',
      'relation',
      'relation_label',
      'note',
    ],
  });
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadFile(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
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
