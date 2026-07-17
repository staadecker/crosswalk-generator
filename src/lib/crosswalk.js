import Papa from 'papaparse';
import { isNoMatch } from './stores.js';

/**
 * One row per code across every group (both its A-side and B-side leaf
 * codes), rather than one row per pairing — a group linking 2 A-codes to 3
 * B-codes produces 5 rows, all sharing the same sequential group_number, not
 * a 6-row cross-product. A no-match group still gets a group number and
 * contributes rows for whichever side actually has codes, with a blank
 * relationship (there's no correspondence to qualify). Each row also carries
 * a `group_name` column: the group's A-side leaf codes joined with ';'
 * (distinct from the group's internal `name` field, which is only used for
 * a11y labels and is never shown or editable in the UI).
 *
 * @param {object[]} groups  mapping groups: { id, name, aLeafCodes, bLeafCodes, note, approx }
 * @param {object|null} systemA  system A (has tree.byCode and a name)
 * @param {object|null} systemB  system B
 * @returns {Array<object>}
 */
export function buildCrosswalkRows(groups, systemA, systemB) {
  const aByCode = systemA?.tree.byCode ?? new Map();
  const bByCode = systemB?.tree.byCode ?? new Map();
  const aName = systemA?.name || 'A';
  const bName = systemB?.name || 'B';
  const rows = [];
  groups.forEach((g, i) => {
    const groupNumber = i + 1;
    const groupName = g.aLeafCodes.join(';');
    const relationship = isNoMatch(g) ? '' : g.approx ? 'approximate' : 'equal';
    for (const code of g.aLeafCodes) {
      const node = aByCode.get(code);
      rows.push({
        group_number: groupNumber,
        group_name: groupName,
        system: 'A',
        system_name: aName,
        code,
        title: node?.title ?? '',
        description: node?.description ?? '',
        relationship,
        note: g.note ?? '',
      });
    }
    for (const code of g.bLeafCodes) {
      const node = bByCode.get(code);
      rows.push({
        group_number: groupNumber,
        group_name: groupName,
        system: 'B',
        system_name: bName,
        code,
        title: node?.title ?? '',
        description: node?.description ?? '',
        relationship,
        note: g.note ?? '',
      });
    }
  });
  return rows;
}

/** Serialize buildCrosswalkRows() output to a CSV string. */
export function crosswalkToCsv(rows) {
  return Papa.unparse(rows, {
    columns: [
      'group_number',
      'group_name',
      'system',
      'system_name',
      'code',
      'title',
      'description',
      'relationship',
      'note',
    ],
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
