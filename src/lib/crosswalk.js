import Papa from 'papaparse';
import { isNoMatch } from './stores.js';

/**
 * Mode A export: one row per A-leaf × B-leaf pair within each group (the full
 * N×N cross-product), joined to descriptions. A no-match group (see
 * isNoMatch) has no counterpart on one side, so it produces one row per code
 * on its populated side with the other side left blank.
 *
 * @param {object[]} groups  mapping groups: { id, name, aLeafCodes, bLeafCodes, note }
 * @param {object|null} systemA  system A (has tree.byCode)
 * @param {object|null} systemB  system B
 * @returns {Array<object>}
 */
export function buildCrosswalkRows(groups, systemA, systemB) {
  const aByCode = systemA?.tree.byCode ?? new Map();
  const bByCode = systemB?.tree.byCode ?? new Map();
  const rows = [];
  for (const g of groups) {
    if (isNoMatch(g)) {
      const aOnly = g.aLeafCodes.length > 0;
      const codes = aOnly ? g.aLeafCodes : g.bLeafCodes;
      const byCode = aOnly ? aByCode : bByCode;
      for (const code of codes) {
        rows.push({
          a_code: aOnly ? code : '',
          a_title: aOnly ? byCode.get(code)?.title ?? '' : '',
          b_code: aOnly ? '' : code,
          b_title: aOnly ? '' : byCode.get(code)?.title ?? '',
          group_name: g.name,
          note: g.note ?? '',
        });
      }
      continue;
    }
    for (const s of g.aLeafCodes) {
      for (const t of g.bLeafCodes) {
        rows.push({
          a_code: s,
          a_title: aByCode.get(s)?.title ?? '',
          b_code: t,
          b_title: bByCode.get(t)?.title ?? '',
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
      'a_code',
      'a_title',
      'b_code',
      'b_title',
      'group_name',
      'note',
    ],
  });
}

/**
 * Mode B, file 1: many-to-one, one row per A leaf code -> its group name.
 * No-match groups with only B codes contribute no rows here.
 */
export function buildAToNameRows(groups, systemA) {
  const aByCode = systemA?.tree.byCode ?? new Map();
  const rows = [];
  for (const g of groups) {
    for (const code of g.aLeafCodes) {
      rows.push({
        a_code: code,
        a_title: aByCode.get(code)?.title ?? '',
        group_name: g.name,
      });
    }
  }
  return rows;
}

/** Serialize buildAToNameRows() output to CSV. */
export function aToNameCsv(rows) {
  return Papa.unparse(rows, { columns: ['a_code', 'a_title', 'group_name'] });
}

/**
 * Mode B, file 2: one-to-many, one row per group name -> B leaf code.
 * No-match groups with only A codes contribute no rows here.
 */
export function buildNameToBRows(groups, systemB) {
  const bByCode = systemB?.tree.byCode ?? new Map();
  const rows = [];
  for (const g of groups) {
    for (const code of g.bLeafCodes) {
      rows.push({
        group_name: g.name,
        b_code: code,
        b_title: bByCode.get(code)?.title ?? '',
      });
    }
  }
  return rows;
}

/** Serialize buildNameToBRows() output to CSV. */
export function nameToBCsv(rows) {
  return Papa.unparse(rows, { columns: ['group_name', 'b_code', 'b_title'] });
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
