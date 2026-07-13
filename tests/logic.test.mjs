/**
 * Unit-level checks for the pure logic modules, run with plain Node (no browser).
 *   npm run test:logic
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { get } from 'svelte/store';

import { parseCsv, guessColumns } from '../src/lib/csv.js';
import { buildHierarchy, flattenTree } from '../src/lib/hierarchy.js';
import { buildCrosswalkRows, crosswalkToCsv } from '../src/lib/crosswalk.js';
import { addMapping, mappings, makeSystem } from '../src/lib/stores.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(cond, msg) {
  console.log((cond ? '✓ ' : '❌ FAIL: ') + msg);
  if (!cond) failures++;
}

const naicsCsv = readFileSync(resolve(root, 'samples/naics-sample.csv'), 'utf8');
const naceCsv = readFileSync(resolve(root, 'samples/nace-sample.csv'), 'utf8');

const A = await parseCsv(naicsCsv);
const B = await parseCsv(naceCsv);

// --- column guessing ---
const gA = guessColumns(A.fields, A.rows);
check(gA.level === 'level', 'guesses the level column');
check(gA.code === 'code', 'guesses the code column');
check(gA.description === 'description', 'guesses the description column');

// --- hierarchy building ---
const sysA = makeSystem('NAICS', A.rows, gA);
const sysB = makeSystem('NACE', B.rows, guessColumns(B.fields, B.rows));

check(sysA.tree.warnings.length === 0, `NAICS builds with no warnings (${sysA.tree.warnings.join('; ')})`);
check(sysA.tree.roots.length === 3, `NAICS has 3 roots (got ${sysA.tree.roots.length})`);
check(sysA.tree.byCode.get('11111').parent === '1111', '11111 nests under 1111');
check(sysA.tree.byCode.get('1111').parent === '111', '1111 nests under 111');
check(sysA.tree.byCode.get('111').parent === '11', '111 nests under 11');
check(sysA.tree.byCode.get('11').parent === null, '11 is a root');
check(sysB.tree.byCode.get('A').parent === null, 'NACE letter section A is a root');
check(sysB.tree.byCode.get('01').parent === 'A', 'NACE 01 nests under section A');
check(sysB.tree.byCode.get('01.11').parent === '01.1', 'NACE 01.11 nests under 01.1');

// --- flattenTree ---
check(flattenTree(sysA.tree, new Set()).length === 3, 'collapsed view shows only the 3 roots');
check(
  flattenTree(sysA.tree, new Set(sysA.tree.nodes.map((n) => n.code))).length === sysA.tree.nodes.length,
  'fully expanded view shows every node',
);
const filtered = flattenTree(sysA.tree, new Set(), (n) => n.description.toLowerCase().includes('soybean'));
const fc = filtered.map((r) => r.node.code);
check(fc.includes('11111'), 'search "soybean" includes the matching leaf');
check(fc.includes('11') && fc.includes('111') && fc.includes('1111'), 'search keeps ancestors of a match');
check(!fc.includes('31'), 'search excludes unrelated subtrees');

// --- mapping + crosswalk export ---
addMapping('11111', '01.11', 'exact');
addMapping('111', '01.1', 'broader');
const dup = addMapping('11111', '01.11', 'related');
check(dup === false, 'duplicate (code pair) mapping is rejected');
check(get(mappings).length === 2, `2 unique mappings stored (got ${get(mappings).length})`);

const rows = buildCrosswalkRows(get(mappings), sysA, sysB);
check(rows[0].source_description === 'Soybean Farming', 'crosswalk joins the source description');
check(rows[0].target_description.includes('cereals'), 'crosswalk joins the target description');
const header = crosswalkToCsv(rows).split(/\r?\n/)[0];
check(
  header === 'source_code,source_description,target_code,target_description,relation,relation_label,note',
  'exported CSV has the expected 7-column header',
);

// --- hierarchy warnings ---
const bad = buildHierarchy(
  [
    { level: '2', code: 'x', description: 'child before any parent' },
    { level: '1', code: 'y', description: 'root' },
  ],
  { level: 'level', code: 'code', description: 'description' },
);
check(bad.roots.length === 2, 'a child before any parent becomes its own root');
const dupCode = buildHierarchy(
  [
    { level: '1', code: 'z', description: 'a' },
    { level: '1', code: 'z', description: 'b' },
  ],
  { level: 'level', code: 'code', description: 'description' },
);
check(dupCode.warnings.some((w) => w.includes('duplicate')), 'duplicate code produces a warning');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll logic checks passed.');
process.exit(failures ? 1 : 0);
