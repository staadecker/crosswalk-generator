import Papa from 'papaparse';
import { isNoMatch } from './stores.js';

/**
 * Mode A export: one row per source-leaf × target-leaf pair within each group
 * (the full N×N cross-product), joined to descriptions. A no-match group (see
 * isNoMatch) has no counterpart on one side, so it produces one row per code
 * on its populated side with the other side left blank.
 *
 * @param {object[]} groups  mapping groups: { id, name, sourceLeafCodes, targetLeafCodes, note }
 * @param {object|null} systemA  source system (has tree.byCode)
 * @param {object|null} systemB  target system
 * @returns {Array<object>}
 */
export function buildCrosswalkRows(groups, systemA, systemB) {
  const aByCode = systemA?.tree.byCode ?? new Map();
  const bByCode = systemB?.tree.byCode ?? new Map();
  const rows = [];
  for (const g of groups) {
    if (isNoMatch(g)) {
      const sourceOnly = g.sourceLeafCodes.length > 0;
      const codes = sourceOnly ? g.sourceLeafCodes : g.targetLeafCodes;
      const byCode = sourceOnly ? aByCode : bByCode;
      for (const code of codes) {
        rows.push({
          source_code: sourceOnly ? code : '',
          source_title: sourceOnly ? byCode.get(code)?.title ?? '' : '',
          target_code: sourceOnly ? '' : code,
          target_title: sourceOnly ? '' : byCode.get(code)?.title ?? '',
          group_name: g.name,
          note: g.note ?? '',
        });
      }
      continue;
    }
    for (const s of g.sourceLeafCodes) {
      for (const t of g.targetLeafCodes) {
        rows.push({
          source_code: s,
          source_title: aByCode.get(s)?.title ?? '',
          target_code: t,
          target_title: bByCode.get(t)?.title ?? '',
          group_name: g.name,
          note: g.note ?? '',
        });
      }
    }
  }
  return rows;
}

/** Serialize buildCrosswalkRows() output to a CSV string (export mode A). */
export function crosswalkToCsv(rows) {
  return Papa.unparse(rows, {
    columns: [
      'source_code',
      'source_title',
      'target_code',
      'target_title',
      'group_name',
      'note',
    ],
  });
}

/**
 * Mode B, file 1: many-to-one, one row per source leaf code -> its group name.
 * No-match groups with only target codes contribute no rows here.
 */
export function buildSourceToNameRows(groups, systemA) {
  const aByCode = systemA?.tree.byCode ?? new Map();
  const rows = [];
  for (const g of groups) {
    for (const code of g.sourceLeafCodes) {
      rows.push({
        source_code: code,
        source_title: aByCode.get(code)?.title ?? '',
        group_name: g.name,
      });
    }
  }
  return rows;
}

/** Serialize buildSourceToNameRows() output to CSV. */
export function sourceToNameCsv(rows) {
  return Papa.unparse(rows, { columns: ['source_code', 'source_title', 'group_name'] });
}

/**
 * Mode B, file 2: one-to-many, one row per group name -> target leaf code.
 * No-match groups with only source codes contribute no rows here.
 */
export function buildNameToTargetRows(groups, systemB) {
  const bByCode = systemB?.tree.byCode ?? new Map();
  const rows = [];
  for (const g of groups) {
    for (const code of g.targetLeafCodes) {
      rows.push({
        group_name: g.name,
        target_code: code,
        target_title: bByCode.get(code)?.title ?? '',
      });
    }
  }
  return rows;
}

/** Serialize buildNameToTargetRows() output to CSV. */
export function nameToTargetCsv(rows) {
  return Papa.unparse(rows, { columns: ['group_name', 'target_code', 'target_title'] });
}

/** Trigger a browser download of `content` (text) as `filename`. */
export function downloadFile(filename, content, mime = 'text/plain') {
  downloadBlob(filename, new Blob([content], { type: `${mime};charset=utf-8` }));
}

/** Trigger a browser download of a pre-built `blob` (e.g. a zip archive) as `filename`. */
export function downloadBlob(filename, blob) {
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
