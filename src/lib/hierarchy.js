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
 * matches (ancestors are kept so matches stay reachable). Whether a node's
 * children are actually shown still depends on `expanded` either way — a
 * caller that wants matches auto-revealed the first time a search starts (so
 * the user isn't stuck manually expanding down to them) should seed `expanded`
 * itself before calling this; a matching descendant no longer force-opens its
 * ancestors on every call, since that made it impossible to collapse a
 * section that's part of the current search results.
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

    if (hasChildren && expanded.has(node.code)) {
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

/** Whether a set of codes uses "." as an explicit hierarchy separator. */
function usesDotSeparators(codes) {
  return codes.some((c) => c.includes('.'));
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
 * them into two ranks — there's no literal string-prefix relationship between
 * a letter and a number, so this document-order-driven ranking is the only
 * way to nest them; contrast reparentDottedCodes below, which overrides this
 * for dotted codes using an actual structural relationship instead).
 *
 * @param {string[]} codes
 * @returns {{ keyOf: (code: string) => string, rank: Map<string, number> }}
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
function assignAutoLevels(rows, codeCol) {
  const codes = rows.map((r) => (r[codeCol] ?? '').trim()).filter((c) => c !== '');
  const { keyOf, rank } = rankCodeShapes(codes);
  return rows.map((r) => {
    const code = (r[codeCol] ?? '').trim();
    return code === '' ? null : rank.get(keyOf(code)) ?? null;
  });
}

/**
 * Given a code, list its possible ancestor codes purely from string
 * structure, nearest first:
 *
 * - Dot-separated codes: within the trailing "."-segment, progressively drop
 *   one trailing character at a time before dropping the whole segment (e.g.
 *   "01.111" -> "01.11" -> "01.1" -> "01"). This lets a longer trailing
 *   segment resolve to a *more specific* existing ancestor when one exists
 *   (e.g. "01.11" nests under an existing "01.1", and "13.20" nests under an
 *   existing "13.2") rather than always jumping straight to the code with the
 *   whole last segment dropped. A single-character trailing segment only
 *   ever produces the whole-segment-drop candidate, since there's nothing
 *   shorter to try within it.
 * - Length-based codes: truncate to each shorter effective code length
 *   actually present in the dataset (e.g. "11111" -> "1111" -> "111" -> "11",
 *   nearest first), substituting a hyphenated sector-range code (e.g.
 *   "48-49") for a plain truncated prefix that falls inside its range — e.g.
 *   truncating "491" to 2 digits yields "48-49", not a made-up "49".
 *
 * @param {string} code
 * @param {'dots'|'length'} convention
 * @param {number[]} shorterLengths  distinct effective lengths < the code's own, ascending
 * @param {Map<number, {lo: number, hi: number, code: string}[]>} [hyphenRangesByDigits]
 * @returns {string[]}  candidate ancestor codes, nearest first
 */
function guessAncestorCodes(code, convention, shorterLengths, hyphenRangesByDigits) {
  const chain = [];
  if (convention === 'dots') {
    let cur = code;
    while (true) {
      const lastDot = cur.lastIndexOf('.');
      if (lastDot === -1) break;
      const prefix = cur.slice(0, lastDot);
      const lastSegment = cur.slice(lastDot + 1);
      for (let k = lastSegment.length - 1; k >= 1; k--) {
        chain.push(`${prefix}.${lastSegment.slice(0, k)}`);
      }
      chain.push(prefix);
      cur = prefix;
    }
  } else {
    // shorterLengths is ascending; walk it back-to-front for nearest first.
    for (let i = shorterLengths.length - 1; i >= 0; i--) {
      const len = shorterLengths[i];
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
 * Precompute the shared context (dot-vs-length convention, distinct shorter
 * effective lengths, hyphenated sector-range codes present) needed to run
 * guessAncestorCodes across a whole dataset.
 *
 * @param {string[]} codes  every real (non-blank) code in the dataset
 */
function ancestorContext(codes) {
  const convention = usesDotSeparators(codes) ? 'dots' : 'length';
  const shorterLengths = [...new Set(codes.map(effectiveLength))].sort((a, b) => a - b);

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
  return { convention, shorterLengths, hyphenRangesByDigits };
}

/** guessAncestorCodes, always returned nearest-ancestor-first regardless of convention. */
function nearestAncestorChain(code, ctx) {
  return guessAncestorCodes(code, ctx.convention, ctx.shorterLengths, ctx.hyphenRangesByDigits);
}

/**
 * Like nearestAncestorChain, but for dot-separated codes it only ever drops a
 * whole "."-segment at a time — never the char-by-char sub-segment candidates
 * nearestAncestorChain also tries (see guessAncestorCodes). Those sub-segment
 * candidates exist to let reparentDottedCodes prefer an *existing* more
 * specific code (e.g. NACE's real "01.1" for "01.11") without ever inventing
 * one; synthesizeMissingParents, in contrast, may fabricate a brand-new
 * placeholder for every rung it's given, so blindly reusing the same
 * char-by-char ladder there manufactures spurious intermediate levels no
 * dataset actually implied (e.g. "13.20.11" would get a fabricated "13.20.1"
 * in between, when only "13.20" was ever a real level for that convention).
 * The whole-segment-only ladder is dot-count exactly one shallower per rung,
 * which is the only depth relationship synthesis can safely assume without
 * evidence (an existing code) to justify a finer one.
 */
function wholeSegmentAncestorChain(code, ctx) {
  if (ctx.convention !== 'dots') return nearestAncestorChain(code, ctx);
  const chain = [];
  let cur = code;
  while (cur.includes('.')) {
    cur = cur.slice(0, cur.lastIndexOf('.'));
    chain.push(cur);
  }
  return chain;
}

/**
 * Disambiguate a synthesized "group" placeholder's code against every code
 * string already in use (real, or already synthesized), so the rare case
 * where "<code> (group)" itself happens to collide with a real/used code
 * still resolves to something unique instead of silently merging two nodes.
 *
 * @param {string} baseCode  the real code being replaced as a structural parent
 * @param {Set<string>} used  every code string currently in use
 * @returns {string}
 */
/**
 * Internal column name synthesizeMissingParents stamps onto every row it
 * returns, holding that row's true 1-based depth-first level — see the
 * comment at its `visit` helper for why buildAutoHierarchy must use this
 * instead of re-deriving levels from code shape once synthesis has run.
 */
const SYNTH_LEVEL_COL = '__synthLevel__';

function disambiguateGroupCode(baseCode, used) {
  let candidate = `${baseCode} (group)`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${baseCode} (group ${n})`;
    n += 1;
  }
  return candidate;
}

/**
 * Synthesize a blank-title row for any ancestor code implied by an existing
 * code's structure but not itself present in the dataset (e.g. "01.a" and
 * "01.b" exist but "01" doesn't — a "01" row is added so the hierarchy still
 * nests instead of leaving "01.a"/"01.b" as orphan roots).
 *
 * Every provided code is treated as a leaf/child, never as an implicit
 * structural parent: if a code's natural ancestor rung (per
 * wholeSegmentAncestorChain) coincides with a code that is *itself* provided
 * (not a synthesized placeholder), that real code is "already taken" and
 * cannot double as the structural parent. Instead a new, disambiguated
 * placeholder node is synthesized — literally "<code> (group)" (see
 * disambiguateGroupCode for the rare fallback when even that string
 * collides) — which becomes the parent of *both* the real code and whatever
 * needed it as an ancestor (e.g. "20" and "20.w" both provided synthesizes a
 * new "20 (group)" node, with real "20" and real "20.w" as its two children —
 * the real code always ends up *nested under* its own group node, never left
 * dangling as a bare sibling of it). This chains: if a colliding code's own
 * natural parent is itself a colliding real code, that rung gets its own
 * "(group)" node the same way, and so on up the tree (memoized per colliding
 * code, so multiple codes sharing the same colliding ancestor share the same
 * single group node). Only *whole* "."-segments are ever dropped when
 * inferring an ancestor here (contrast reparentDottedCodes's finer
 * char-by-char search for an *existing* more-specific code) — synthesis may
 * fabricate a brand-new node for whatever rung it's given, so it must not
 * guess at a depth finer than one level per "."-segment without an existing
 * code to justify it. A rung that's missing entirely (not provided at all)
 * still gets a plain blank-title placeholder at its literal code, exactly as
 * before.
 *
 * Rows are returned in a proper depth-first order: each (real or synthesized)
 * parent is immediately followed by its own children before any other branch
 * resumes. This is stronger than merely "shallower rows sort first" — a flat
 * shallowest-first sort still interleaves unrelated branches at the same
 * depth, which breaks buildHierarchy's "parent is the *nearest* preceding
 * row with a smaller level" rule (e.g. a dataset with multiple depth-1
 * branches would see every depth-2 row across the whole file nest under
 * whichever depth-1 row happens to sort last, instead of its real parent).
 * Returns `rows` unchanged (same reference) when nothing is missing and
 * nothing collides.
 *
 * @param {Record<string,string>[]} rows
 * @param {{ code: string, title: string }} colMap
 * @returns {Record<string,string>[]}
 */
export function synthesizeMissingParents(rows, colMap) {
  const { code: codeCol, title: titleCol } = colMap;
  const realCodes = rows.map((r) => (r[codeCol] ?? '').trim()).filter((c) => c !== '');
  const codes = new Set(realCodes);
  const ctx = ancestorContext(realCodes);

  // Pass 1: find every real code that's "taken" — i.e. appears as an ancestor
  // rung of some *other* real code — before assigning any parent pointers.
  // Doing this fully upfront (rather than discovering a collision and fixing
  // up parents in the very same pass) matters: a colliding code is *also*
  // processed as its own top-level entry below, computing its own "natural"
  // parent from its own structure. If that happened before its collision was
  // known, it would lock in the wrong parent (its natural one, not its own
  // "(group)" stand-in) and a later guard (`if (!parentOf.has(...))`) would
  // then refuse to correct it — leaving a correctly-created "<code> (group)"
  // node with the real code itself missing from underneath it.
  const takenAsAncestor = new Set();
  for (const code of realCodes) {
    for (const ancestor of wholeSegmentAncestorChain(code, ctx)) {
      if (codes.has(ancestor)) takenAsAncestor.add(ancestor);
    }
  }

  // Every code string currently in use — used to disambiguate a "(group)"
  // candidate that itself happens to already be taken.
  const used = new Set(realCodes);
  const groupCodeOf = new Map(); // real (colliding) code -> its synthesized "<code> (group)" stand-in
  for (const realCode of takenAsAncestor) {
    const g = disambiguateGroupCode(realCode, used);
    used.add(g);
    groupCodeOf.set(realCode, g);
  }

  // Pass 2: assign every code's (and every synthesized placeholder's) parent,
  // now that every collision is already known. Every colliding real code's
  // parent is seeded as its own group node *before* the main walk runs, so
  // that walk (which would otherwise derive that code's "natural" parent from
  // its own structure) can't pre-empt it — see the note on pass 1 above.
  const parentOf = new Map();
  for (const [realCode, groupCode] of groupCodeOf) {
    parentOf.set(realCode, groupCode);
  }
  const missing = new Set();
  for (const code of realCodes) {
    let child = code;
    for (const ancestor of wholeSegmentAncestorChain(code, ctx)) {
      const effectiveParent = groupCodeOf.get(ancestor) ?? ancestor;
      if (!codes.has(ancestor)) missing.add(ancestor);
      if (!parentOf.has(child)) parentOf.set(child, effectiveParent);
      child = effectiveParent;
    }
  }
  if (!missing.size && !groupCodeOf.size) return rows;

  const rowByCode = new Map(rows.map((r) => [(r[codeCol] ?? '').trim(), r]));
  for (const code of missing) rowByCode.set(code, { [codeCol]: code, [titleCol]: '' });
  for (const code of groupCodeOf.values()) rowByCode.set(code, { [codeCol]: code, [titleCol]: '' });

  const allCodesPrePrune = [...realCodes, ...missing, ...groupCodeOf.values()];
  const childrenOf = new Map();
  for (const code of allCodesPrePrune) {
    const parent = parentOf.get(code);
    if (parent === undefined) continue;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(code);
  }

  // Elide a blank-title placeholder that ends up wrapping only a single
  // child — such a node adds an extra nesting level without helping the user
  // navigate anything, so its lone child is reparented directly onto
  // whatever the placeholder's own parent was. That parent may itself become
  // newly single-child once the placeholder is gone, so this repeats to a
  // fixed point (e.g. a dataset that only ever uses one code under "13.20",
  // which itself is the only code under "13", elides both placeholders and
  // reparents the leaf straight onto "13"'s own parent, or onto the root
  // level if "13" had none). Real "(group)" nodes are never elided this
  // way: a group node exists specifically because its own code collides
  // with an ancestor rung another real code needs, so it always has at
  // least two children (the colliding real code itself, plus whatever
  // needed it) — see the two comments above `groupCodeOf`.
  let prunedSomething = true;
  while (prunedSomething) {
    prunedSomething = false;
    for (const code of [...missing]) {
      const kids = childrenOf.get(code);
      if (!kids || kids.length !== 1) continue;
      const [onlyChild] = kids;
      const grandparent = parentOf.get(code);
      if (grandparent === undefined) parentOf.delete(onlyChild);
      else {
        parentOf.set(onlyChild, grandparent);
        const siblings = childrenOf.get(grandparent) ?? [];
        siblings.splice(siblings.indexOf(code), 1, onlyChild);
      }
      childrenOf.delete(code);
      parentOf.delete(code);
      missing.delete(code);
      prunedSomething = true;
    }
  }

  const allCodes = [...realCodes, ...missing, ...groupCodeOf.values()];
  // A synthesized code is only ever appended to `allCodes` after every real one,
  // so without sorting it would always land last among its siblings regardless of
  // its actual value (e.g. a synthesized "01" ancestor's siblings, or a
  // synthesized code that happens to share a parent with later-synthesized ones).
  // Natural (numeric-aware) sort puts every sibling — real or synthesized — in
  // its proper position instead.
  const byCodeNatural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  for (const children of childrenOf.values()) children.sort(byCodeNatural);
  const roots = allCodes.filter((code) => parentOf.get(code) === undefined).sort(byCodeNatural);

  // Stamp each output row with its true (depth-first-derived) 1-based level.
  // buildAutoHierarchy uses this directly rather than re-deriving levels from
  // each code's own string shape (see SYNTH_LEVEL_COL) — that shape-based
  // system has no way to place a synthesized "<code> (group)" placeholder,
  // whose string doesn't fit the dataset's normal dot/length shape at all.
  const out = [];
  const seen = new Set();
  const visit = (code, depth) => {
    if (seen.has(code)) return;
    seen.add(code);
    out.push({ ...rowByCode.get(code), [SYNTH_LEVEL_COL]: String(depth + 1) });
    for (const child of childrenOf.get(code) ?? []) visit(child, depth + 1);
  };
  roots.forEach((code) => visit(code, 0));
  return out;
}

/**
 * Build a hierarchy without an explicit level column: each code's parent is
 * the *nearest* ancestor code that actually exists in the dataset, found by
 * progressively shortening the code — see guessAncestorCodes for the exact
 * candidate order. A code with no existing ancestor becomes a root (unless
 * `synthesizeParents` fills every gap first — see synthesizeMissingParents,
 * after which every candidate's nearest rung is guaranteed to exist).
 *
 * This looks parents up directly by code rather than by document position
 * (contrast buildHierarchy's "nearest *preceding* row with a smaller level"),
 * so unlike the explicit-level path it isn't sensitive to file order, and it
 * correctly distinguishes same-depth siblings whose trailing segment varies
 * in width (e.g. "13.1" and "13.20" both nesting under "13") from a genuinely
 * deeper level that happens to share a dot-count (e.g. NACE's "01.11" class
 * nesting under its "01.1" group, not under "01").
 *
 * @param {Record<string,string>[]} rows
 * @param {{ code: string, title: string, description?: string|null }} colMap  no `level` needed
 * @param {{ synthesizeParents?: boolean }} [opts]
 * @returns  same shape as buildHierarchy
 */
export function buildAutoHierarchy(rows, colMap, { synthesizeParents = false } = {}) {
  const workingRows = synthesizeParents ? synthesizeMissingParents(rows, colMap) : rows;

  // If synthesis actually added or regrouped anything, workingRows is a new
  // array whose rows are already stamped with their true depth-first level
  // (see synthesizeMissingParents) — build directly from that rather than
  // re-deriving levels from each code's own string shape, which has no
  // sensible answer for a synthesized "<code> (group)" placeholder code.
  if (workingRows !== rows) {
    return buildHierarchy(workingRows, { ...colMap, level: SYNTH_LEVEL_COL });
  }

  const AUTO_LEVEL_COL = '__autoLevel__';
  const levels = assignAutoLevels(workingRows, colMap.code);
  const rowsWithLevel = workingRows.map((r, i) => ({
    ...r,
    [AUTO_LEVEL_COL]: levels[i] == null ? '' : String(levels[i]),
  }));
  const tree = buildHierarchy(rowsWithLevel, { ...colMap, level: AUTO_LEVEL_COL });
  reparentDottedCodes(tree);
  return tree;
}

/**
 * Correct the parent of every dotted code to the nearest ancestor that
 * actually exists in the dataset (see guessAncestorCodes), overriding
 * whatever assignAutoLevels + buildHierarchy's rank-and-document-order
 * approach produced for it.
 *
 * That rank-based approach is a good default for dot-less codes (rank ties
 * there have no literal string relationship to fall back on — e.g. NACE's
 * single-letter sections vs its 2-digit divisions — so document order is the
 * only signal available), but once a code has a dot, its own structure is a
 * strictly more reliable signal than rank-and-position: two codes can share a
 * dot-count yet sit at different depths (NACE's "01.11" class nests under
 * its "01.1" group, not as a sibling of it), while others share a dot-count
 * and *do* belong at the same depth despite a wider trailing segment (e.g.
 * "13.1" and "13.20" are both direct children of "13"). Re-deriving each
 * dotted code's parent from its own nearest existing prefix resolves both
 * cases correctly without guessing at dataset-wide intent.
 *
 * Mutates `tree` in place (childrenOf/roots/node.parent/node.depth/node.level).
 *
 * @param {object} tree  result of buildHierarchy
 */
function reparentDottedCodes(tree) {
  const ctx = ancestorContext(tree.nodes.map((n) => n.code));
  let changed = false;

  for (const node of tree.nodes) {
    if (!node.code.includes('.')) continue;
    const chain = nearestAncestorChain(node.code, ctx);
    const newParent = chain.find((c) => tree.byCode.has(c)) ?? null;
    if (newParent === node.parent) continue;

    changed = true;
    if (node.parent === null) {
      tree.roots.splice(tree.roots.indexOf(node), 1);
    } else {
      const oldSiblings = tree.childrenOf.get(node.parent);
      oldSiblings.splice(oldSiblings.indexOf(node), 1);
    }
    node.parent = newParent;
    if (newParent === null) {
      tree.roots.push(node);
    } else {
      if (!tree.childrenOf.has(newParent)) tree.childrenOf.set(newParent, []);
      tree.childrenOf.get(newParent).push(node);
    }
  }

  if (!changed) return;
  // Re-derive depth/level from the (possibly changed) parent chain — a
  // reparented node, and everything nested under it, may sit at a new depth.
  const visit = (node, depth) => {
    node.depth = depth;
    node.level = depth + 1;
    for (const child of tree.childrenOf.get(node.code) ?? []) visit(child, depth + 1);
  };
  tree.roots.forEach((node) => visit(node, 0));
}
