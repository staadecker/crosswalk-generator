import Papa from 'papaparse';

/**
 * Parse a CSV File (or string) into { fields, rows }.
 * Uses PapaParse with header detection, dynamic typing off (we keep strings and
 * coerce ourselves where needed), and empty-line skipping.
 *
 * @param {File|string} input
 * @returns {Promise<{ fields: string[], rows: Record<string,string>[] }>}
 */
export function parseCsv(input) {
  return new Promise((resolve, reject) => {
    Papa.parse(input, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const fields = (results.meta.fields ?? []).filter((f) => f && f.length);
        // Normalize: trim every string cell.
        const rows = results.data.map((row) => {
          const out = {};
          for (const f of fields) {
            const v = row[f];
            out[f] = v == null ? '' : String(v).trim();
          }
          return out;
        });
        resolve({ fields, rows });
      },
      error: (err) => reject(err),
    });
  });
}

/**
 * Heuristically guess which columns hold the level, code, title, and
 * (optional, longer-form) description. Title and description are guessed
 * together since they compete for the same signal (both are free text): an
 * explicit title/name/label-ish column name always wins the title slot over
 * a longer description-ish column, so a file with both "Title" and
 * "Description" columns doesn't have its long-form description mistaken for
 * the short title just because it has more text. When only one free-text
 * column exists, it's guessed as the title and description is left unset.
 *
 * @param {string[]} fields
 * @param {Record<string,string>[]} rows
 * @returns {{ level: string|null, code: string|null, title: string|null, description: string|null }}
 */
export function guessColumns(fields, rows) {
  if (!fields.length) return { level: null, code: null, title: null, description: null };

  const sample = rows.slice(0, 200);
  const stats = fields.map((f) => {
    const values = sample.map((r) => r[f]).filter((v) => v !== '');
    const n = values.length || 1;
    let numeric = 0;
    let smallInt = 0;
    let totalLen = 0;
    const seen = new Set();
    let maxNum = -Infinity;
    for (const v of values) {
      totalLen += v.length;
      seen.add(v);
      const num = Number(v);
      if (v !== '' && Number.isFinite(num)) {
        numeric++;
        if (Number.isInteger(num)) {
          maxNum = Math.max(maxNum, num);
          if (num >= 0 && num <= 12) smallInt++;
        }
      }
    }
    return {
      field: f,
      avgLen: totalLen / n,
      uniqueRatio: seen.size / n,
      numericRatio: numeric / n,
      smallIntRatio: smallInt / n,
      distinctCount: seen.size,
      maxNum,
    };
  });

  // Level: mostly small integers, few distinct values, low header hint bonus.
  const level = pickBest(stats, (s) => {
    let score = s.smallIntRatio * 3 + (s.distinctCount <= 10 ? 1 : 0);
    if (/lev|tier|depth|rank/i.test(s.field)) score += 2;
    return s.smallIntRatio >= 0.6 ? score : -1;
  });

  // Code: short-ish, highly unique, often (but not always) numeric-looking.
  const code = pickBest(stats, (s) => {
    if (s.field === level) return -1;
    let score = s.uniqueRatio * 3 - s.avgLen * 0.05;
    if (/code|id|naics|nace|sic|isic/i.test(s.field)) score += 2;
    return score;
  });

  // Title: an explicit title/name/label-ish column name wins outright, since that
  // signal is far more reliable than raw text length when a separate, longer
  // description column also exists. Only fall back to "longest remaining text
  // column" (which a lone description-only column will naturally win) when no
  // field name looks title-like.
  const title = pickBest(stats, (s) => {
    if (s.field === level || s.field === code) return -1;
    let score = s.avgLen * 0.01;
    if (/title|name|label/i.test(s.field)) score += 100;
    else if (/desc|text/i.test(s.field)) score += 10;
    return score;
  });

  // Description (optional): the longest remaining text column, excluding
  // level/code/title. Guarded to a minimum average length so a short, unrelated
  // column (e.g. a numeric sort-order field) isn't guessed just for being the
  // only thing left.
  const description = pickBest(stats, (s) => {
    if (s.field === level || s.field === code || s.field === title) return -1;
    if (s.avgLen < 8) return -1;
    let score = s.avgLen;
    if (/desc|detail|definition|explanation|note/i.test(s.field)) score += 100;
    return score;
  });

  return { level, code, title, description };
}

function pickBest(stats, scoreFn) {
  let best = null;
  let bestScore = -Infinity;
  for (const s of stats) {
    const score = scoreFn(s);
    if (score > bestScore) {
      bestScore = score;
      best = s.field;
    }
  }
  return bestScore <= -1 ? null : best;
}
