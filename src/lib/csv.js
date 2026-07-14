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
 * Heuristically guess which columns hold the level, code, and title. The
 * (optional, longer-form) description column is not guessed — it's left for
 * the user to pick explicitly since most files don't have one.
 *
 * @param {string[]} fields
 * @param {Record<string,string>[]} rows
 * @returns {{ level: string|null, code: string|null, title: string|null }}
 */
export function guessColumns(fields, rows) {
  if (!fields.length) return { level: null, code: null, title: null };

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

  // Title: longest average text, not the code/level column.
  const title = pickBest(stats, (s) => {
    if (s.field === level || s.field === code) return -1;
    let score = s.avgLen;
    if (/desc|title|name|label|text/i.test(s.field)) score += 100;
    return score;
  });

  return { level, code, title };
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
