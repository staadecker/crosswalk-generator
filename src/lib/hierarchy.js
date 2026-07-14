/**
 * Build a tree from flat rows using an explicit hierarchy-level column.
 *
 * Nesting rule: walking rows in document order, a row's parent is the nearest
 * preceding row with a strictly smaller level. Rows whose level is the minimum
 * (or that appear before any smaller-level row) become roots. This is robust to
 * skipped or non-dense level numbering (e.g. 1, 2, 4).
 *
 * @param {Record<string,string>[]} rows  parsed CSV rows, in file order
 * @param {{ level: string, code: string, title: string, description?: string|null }} colMap
 *   `title` is the short label shown throughout the UI; `description`, if
 *   mapped, is a longer piece of text shown only as a hover tooltip.
 * @returns {{
 *   nodes: Array<{ code, title, description, level, depth, parent: string|null }>,
 *   byCode: Map<string, object>,
 *   roots: object[],
 *   childrenOf: Map<string, object[]>,
 *   warnings: string[]
 * }}
 */
export function buildHierarchy(rows, colMap) {
  const { level: levelCol, code: codeCol, title: titleCol, description: descCol } = colMap;
  const warnings = [];

  const nodes = [];
  const byCode = new Map();
  const childrenOf = new Map();
  const roots = [];

  // Stack of ancestors currently "open", ordered by increasing level.
  /** @type {Array<{ node: object, level: number }>} */
  const stack = [];

  rows.forEach((row, i) => {
    const rawCode = (row[codeCol] ?? '').trim();
    const title = (row[titleCol] ?? '').trim();
    const description = descCol ? (row[descCol] ?? '').trim() : '';
    const rawLevel = (row[levelCol] ?? '').trim();
    const level = Number(rawLevel);

    if (rawCode === '') {
      warnings.push(`Row ${i + 2}: missing code — row skipped.`);
      return;
    }
    if (rawLevel === '' || !Number.isFinite(level)) {
      warnings.push(`Row ${i + 2} (code "${rawCode}"): missing or non-numeric level — row skipped.`);
      return;
    }
    if (byCode.has(rawCode)) {
      warnings.push(`Row ${i + 2}: duplicate code "${rawCode}" — kept the first occurrence, skipped this one.`);
      return;
    }

    // Pop ancestors whose level is >= this node's level; the remaining top is the parent.
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parentEntry = stack[stack.length - 1];
    const parent = parentEntry ? parentEntry.node.code : null;

    const node = {
      code: rawCode,
      title,
      description,
      level,
      depth: stack.length, // 0-based nesting depth after popping
      parent,
    };

    nodes.push(node);
    byCode.set(rawCode, node);
    if (!childrenOf.has(rawCode)) childrenOf.set(rawCode, []);

    if (parent === null) {
      roots.push(node);
    } else {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(node);
    }

    stack.push({ node, level });
  });

  if (nodes.length && roots.length === 0) {
    warnings.push('No root rows detected — check that the level column is correct.');
  }

  return { nodes, byCode, roots, childrenOf, warnings };
}

/**
 * Depth-first flatten of the tree into an ordered list, respecting a set of
 * expanded codes and an optional filter predicate.
 *
 * When a filter is provided, a node is included if it matches OR any descendant
 * matches (ancestors are kept so matches stay reachable). Matching descendants
 * force their ancestors open regardless of the expanded set.
 *
 * @param {object} tree  result of buildHierarchy
 * @param {Set<string>} expanded  codes whose children are shown
 * @param {(node) => boolean} [matches]  optional search filter
 * @returns {Array<{ node: object, isMatch: boolean, hasChildren: boolean }>}
 */
export function flattenTree(tree, expanded, matches) {
  const out = [];
  const { roots, childrenOf } = tree;

  // Precompute, when filtering, which subtrees contain a match.
  const subtreeMatches = matches ? new Map() : null;
  if (matches) {
    const computeMatch = (node) => {
      let any = matches(node);
      for (const child of childrenOf.get(node.code) ?? []) {
        if (computeMatch(child)) any = true;
      }
      subtreeMatches.set(node.code, any);
      return any;
    };
    roots.forEach(computeMatch);
  }

  const walk = (node) => {
    const children = childrenOf.get(node.code) ?? [];
    const hasChildren = children.length > 0;

    if (matches && !subtreeMatches.get(node.code)) return;

    const isMatch = matches ? matches(node) : false;
    out.push({ node, isMatch, hasChildren });

    // When filtering, force-open ancestors of matches. Otherwise honor `expanded`.
    const open = matches ? true : expanded.has(node.code);
    if (hasChildren && open) {
      for (const child of children) walk(child);
    }
  };

  roots.forEach(walk);
  return out;
}

/**
 * Expand a list of codes (leaf and/or ancestor) into the full set of leaf
 * (childless) codes they cover. A leaf code expands to itself; an ancestor
 * code expands to every leaf beneath it. Only leaf codes are meaningful in an
 * exported crosswalk — ancestor codes exist purely to let the user navigate
 * and select many leaves at once.
 *
 * @param {object} tree  result of buildHierarchy
 * @param {Iterable<string>} codes
 * @returns {Set<string>}
 */
export function expandToLeaves(tree, codes) {
  const { byCode, childrenOf } = tree;
  const result = new Set();
  const walk = (code) => {
    const children = childrenOf.get(code) ?? [];
    if (children.length === 0) {
      result.add(code);
    } else {
      for (const child of children) walk(child.code);
    }
  };
  for (const code of codes) {
    if (byCode.has(code)) walk(code);
  }
  return result;
}

/**
 * Inverse of expandToLeaves, for display: given a set of leaf codes, find the
 * minimal set of codes (a mix of ancestor and/or leaf codes) whose combined
 * leaf coverage is exactly `leafCodeSet`. Used so that selecting/mapping every
 * leaf under a parent (whether by selecting the parent directly, or by
 * selecting literally all of its leaf children) displays as just that parent
 * code instead of a long list of leaves.
 *
 * Greedily prefers the highest ancestor whose full leaf-descendant set is
 * entirely contained in `leafCodeSet`; recurses into children otherwise. A
 * leaf code is always its own trivial "full coverage".
 *
 * @param {object} tree  result of buildHierarchy
 * @param {Set<string>} leafCodeSet
 * @returns {string[]}
 */
export function compactCodes(tree, leafCodeSet) {
  const { roots, childrenOf } = tree;
  const leafSetCache = new Map();

  const leavesOf = (code) => {
    if (leafSetCache.has(code)) return leafSetCache.get(code);
    const children = childrenOf.get(code) ?? [];
    let result;
    if (children.length === 0) {
      result = new Set([code]);
    } else {
      result = new Set();
      for (const child of children) {
        for (const leaf of leavesOf(child.code)) result.add(leaf);
      }
    }
    leafSetCache.set(code, result);
    return result;
  };

  const fullyCovered = (leaves) => {
    if (leaves.size === 0) return false;
    for (const leaf of leaves) {
      if (!leafCodeSet.has(leaf)) return false;
    }
    return true;
  };

  const compact = (node) => {
    if (fullyCovered(leavesOf(node.code))) return [node.code];
    const children = childrenOf.get(node.code) ?? [];
    const out = [];
    for (const child of children) out.push(...compact(child));
    return out;
  };

  const out = [];
  for (const root of roots) out.push(...compact(root));
  return out;
}

/**
 * Every leaf (childless) code in the tree — the codes that are actually
 * meaningful in an exported crosswalk. Used e.g. to compute mapping progress.
 *
 * @param {object} tree  result of buildHierarchy
 * @returns {string[]}
 */
export function leafCodesOf(tree) {
  return tree.nodes.filter((n) => (tree.childrenOf.get(n.code) ?? []).length === 0).map((n) => n.code);
}

// ---------------------------------------------------------------------------
// Auto level detection: an alternative to picking an explicit level column.
// The hierarchy depth is inferred from each code's own structure instead.
// ---------------------------------------------------------------------------

/**
 * Parse a NAICS-style hyphenated sector-range code (e.g. "31-33", "44-45",
 * "48-49" — a single top-level code standing in for a contiguous run of
 * sibling sector numbers) into its numeric bounds. Both sides must be plain
 * digits of the same width so "digits" is unambiguous. Returns null for
 * anything else (including dot-separated codes, which never use this form).
 *
 * @param {string} code
 * @returns {{ lo: number, hi: number, digits: number }|null}
 */
function parseHyphenRange(code) {
  const m = /^(\d+)-(\d+)$/.exec(code);
  if (!m) return null;
  const [, loStr, hiStr] = m;
  if (loStr.length !== hiStr.length) return null;
  return { lo: Number(loStr), hi: Number(hiStr), digits: loStr.length };
}

/**
 * A code's "effective length" for shape-ranking and ancestor-truncation
 * purposes: a hyphenated range code counts as however wide its bounds are
 * (e.g. "48-49" -> 2), since it stands at the same depth as its plain
 * same-width sibling codes (e.g. "11", "21") — not at the depth its raw
 * (longer, hyphen-containing) string length would otherwise suggest.
 *
 * @param {string} code
 * @returns {number}
 */
function effectiveLength(code) {
  return parseHyphenRange(code)?.digits ?? code.length;
}

/**
 * Rank every distinct code "shape" in a dataset by (dot-segment count, then
 * effective length — see effectiveLength), both ascending. This single
 * composite key handles both conventions this app's sample data actually uses:
 * pure dot-separated codes (NACE-style "01" < "01.1" < "01.11") and pure
 * length-based codes (NAICS-style "11" < "111" < "1111", including hyphenated
 * sector ranges like "48-49" ranking alongside plain 2-digit sectors) — and,
 * as a bonus, mixed datasets where a top level has no dots but isn't the same
 * length as the next dot-less level (e.g. NACE's single-letter sections vs its
 * 2-digit divisions: both have 0 dots, but the length tiebreak still separates
 * them into two ranks).
 *
 * @param {string[]} codes
 * @returns {Map<string, number>}  "dots:length" key -> 1-based rank
 */
function rankCodeShapes(codes) {
  const keyOf = (code) => `${(code.match(/\./g) ?? []).length}:${effectiveLength(code)}`;
  const distinct = [...new Set(codes.map(keyOf))]
    .map((k) => k.split(':').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rank = new Map();
  distinct.forEach(([dots, len], i) => rank.set(`${dots}:${len}`, i + 1));
  return { keyOf, rank };
}

/**
 * Infer a 1-based hierarchy level per row directly from each row's code,
 * without requiring an explicit level column — see rankCodeShapes.
 *
 * @param {Record<string,string>[]} rows
 * @param {string} codeCol
 * @returns {Array<number|null>}  level per row (null for rows with no code)
 */
export function assignAutoLevels(rows, codeCol) {
  const codes = rows.map((r) => (r[codeCol] ?? '').trim()).filter((c) => c !== '');
  const { keyOf, rank } = rankCodeShapes(codes);
  return rows.map((r) => {
    const code = (r[codeCol] ?? '').trim();
    return code === '' ? null : rank.get(keyOf(code)) ?? null;
  });
}

/** Whether a set of codes uses "." as an explicit hierarchy separator. */
function usesDotSeparators(codes) {
  return codes.some((c) => c.includes('.'));
}

/**
 * Given a code, guess the codes of its "missing" ancestors purely from string
 * structure: for dot-separated codes, repeatedly drop the last "."-segment
 * (e.g. "01.11" -> "01.1" -> "01"); for length-based codes, truncate to each
 * shorter effective code length actually present in the dataset (e.g. "11111"
 * -> "1111" -> "111" -> "11", when those lengths occur elsewhere in the data).
 *
 * At a length where the dataset has a hyphenated sector-range code (e.g.
 * "48-49" covering plain prefixes 48-49), a plain truncated prefix that falls
 * inside that range resolves to the range code instead of a fabricated bare
 * prefix — e.g. truncating "491" to 2 digits yields "48-49", not a made-up "49".
 *
 * @param {string} code
 * @param {'dots'|'length'} convention
 * @param {number[]} shorterLengths  distinct effective lengths < the code's own, ascending
 * @param {Map<number, {lo: number, hi: number, code: string}[]>} [hyphenRangesByDigits]
 * @returns {string[]}
 */
function guessAncestorCodes(code, convention, shorterLengths, hyphenRangesByDigits) {
  const chain = [];
  if (convention === 'dots') {
    let cur = code;
    while (cur.includes('.')) {
      cur = cur.slice(0, cur.lastIndexOf('.'));
      chain.push(cur);
    }
  } else {
    for (const len of shorterLengths) {
      if (len >= effectiveLength(code)) continue;
      const prefix = code.slice(0, len);
      const ranges = hyphenRangesByDigits?.get(len);
      const n = Number(prefix);
      const inRange = ranges && Number.isFinite(n) ? ranges.find((r) => n >= r.lo && n <= r.hi) : null;
      chain.push(inRange ? inRange.code : prefix);
    }
  }
  return chain;
}

/**
 * Synthesize a blank-title row for any ancestor code implied by an existing
 * code's structure but not itself present in the dataset (e.g. "01.a" and
 * "01.b" exist but "01" doesn't — a "01" row is added so the hierarchy still
 * nests instead of leaving "01.a"/"01.b" as orphan roots).
 *
 * Rows are returned in a proper depth-first order: each (real or synthesized)
 * parent is immediately followed by its own children before any other branch
 * resumes. This is stronger than merely "shallower rows sort first" — a flat
 * shallowest-first sort still interleaves unrelated branches at the same
 * depth, which breaks buildHierarchy's "parent is the *nearest* preceding
 * row with a smaller level" rule (e.g. a dataset with multiple depth-1
 * branches would see every depth-2 row across the whole file nest under
 * whichever depth-1 row happens to sort last, instead of its real parent).
 * Returns `rows` unchanged (same reference) when nothing is missing.
 *
 * @param {Record<string,string>[]} rows
 * @param {{ code: string, title: string }} colMap
 * @returns {Record<string,string>[]}
 */
export function synthesizeMissingParents(rows, colMap) {
  const { code: codeCol, title: titleCol } = colMap;
  const realCodes = rows.map((r) => (r[codeCol] ?? '').trim()).filter((c) => c !== '');
  const codes = new Set(realCodes);
  const convention = usesDotSeparators([...codes]) ? 'dots' : 'length';
  const shorterLengths = [...new Set([...codes].map(effectiveLength))].sort((a, b) => a - b);

  // Hyphenated sector-range codes actually present in the dataset (e.g. "48-49"),
  // grouped by digit-width, so a plain truncated prefix that falls inside one
  // resolves to the range code instead of a fabricated bare prefix — see
  // guessAncestorCodes.
  const hyphenRangesByDigits = new Map();
  for (const code of codes) {
    const range = parseHyphenRange(code);
    if (!range) continue;
    if (!hyphenRangesByDigits.has(range.digits)) hyphenRangesByDigits.set(range.digits, []);
    hyphenRangesByDigits.get(range.digits).push({ lo: range.lo, hi: range.hi, code });
  }

  // Immediate parent of every code that needs one (real or synthesized), found by
  // walking each real code's full ancestor chain nearest-parent-first and
  // recording (then continuing to walk up from) every ancestor along the way, so
  // ancestors-of-ancestors get a parent too.
  const parentOf = new Map();
  const missing = new Set();
  for (const code of realCodes) {
    const chain = guessAncestorCodes(code, convention, shorterLengths, hyphenRangesByDigits);
    const nearestFirst = convention === 'dots' ? chain : [...chain].reverse();
    let child = code;
    for (const ancestor of nearestFirst) {
      if (!parentOf.has(child)) parentOf.set(child, ancestor);
      if (!codes.has(ancestor)) missing.add(ancestor);
      child = ancestor;
    }
  }
  if (!missing.size) return rows;

  const rowByCode = new Map(rows.map((r) => [(r[codeCol] ?? '').trim(), r]));
  for (const code of missing) rowByCode.set(code, { [codeCol]: code, [titleCol]: '' });

  const allCodes = [...realCodes, ...missing];
  const childrenOf = new Map();
  for (const code of allCodes) {
    const parent = parentOf.get(code);
    if (parent === undefined) continue;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(code);
  }
  // A synthesized code is only ever appended to `allCodes` after every real one,
  // so without sorting it would always land last among its siblings regardless of
  // its actual value (e.g. a synthesized "01" ancestor's siblings, or a
  // synthesized code that happens to share a parent with later-synthesized ones).
  // Natural (numeric-aware) sort puts every sibling — real or synthesized — in
  // its proper position instead.
  const byCodeNatural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  for (const children of childrenOf.values()) children.sort(byCodeNatural);
  const roots = allCodes.filter((code) => parentOf.get(code) === undefined).sort(byCodeNatural);

  const out = [];
  const seen = new Set();
  const visit = (code) => {
    if (seen.has(code)) return;
    seen.add(code);
    out.push(rowByCode.get(code));
    for (const child of childrenOf.get(code) ?? []) visit(child);
  };
  roots.forEach(visit);
  return out;
}

/**
 * Build a hierarchy without an explicit level column: levels are inferred
 * from code structure alone (see assignAutoLevels). Optionally synthesizes
 * missing ancestor codes first (see synthesizeMissingParents).
 *
 * @param {Record<string,string>[]} rows
 * @param {{ code: string, title: string, description?: string|null }} colMap  no `level` needed
 * @param {{ synthesizeParents?: boolean }} [opts]
 * @returns  same shape as buildHierarchy
 */
export function buildAutoHierarchy(rows, colMap, { synthesizeParents = false } = {}) {
  const workingRows = synthesizeParents ? synthesizeMissingParents(rows, colMap) : rows;
  const AUTO_LEVEL_COL = '__autoLevel__';
  const levels = assignAutoLevels(workingRows, colMap.code);
  const rowsWithLevel = workingRows.map((r, i) => ({
    ...r,
    [AUTO_LEVEL_COL]: levels[i] == null ? '' : String(levels[i]),
  }));
  return buildHierarchy(rowsWithLevel, { ...colMap, level: AUTO_LEVEL_COL });
}
