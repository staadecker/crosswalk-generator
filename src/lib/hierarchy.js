/**
 * Build a tree from flat rows using an explicit hierarchy-level column.
 *
 * Nesting rule: walking rows in document order, a row's parent is the nearest
 * preceding row with a strictly smaller level. Rows whose level is the minimum
 * (or that appear before any smaller-level row) become roots. This is robust to
 * skipped or non-dense level numbering (e.g. 1, 2, 4).
 *
 * @param {Record<string,string>[]} rows  parsed CSV rows, in file order
 * @param {{ level: string, code: string, description: string }} colMap
 * @returns {{
 *   nodes: Array<{ code, description, level, depth, parent: string|null }>,
 *   byCode: Map<string, object>,
 *   roots: object[],
 *   childrenOf: Map<string, object[]>,
 *   warnings: string[]
 * }}
 */
export function buildHierarchy(rows, colMap) {
  const { level: levelCol, code: codeCol, description: descCol } = colMap;
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
    const description = (row[descCol] ?? '').trim();
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
 * @param {(node) => boolean} [matches]  optional filter
 * @returns {Array<{ node: object, visible: boolean, isMatch: boolean, hasChildren: boolean }>}
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
