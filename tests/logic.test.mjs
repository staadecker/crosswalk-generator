/**
 * Unit-level checks for the pure logic modules, run with plain Node (no browser).
 *   npm run test:logic
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { get } from 'svelte/store';

import { parseCsv, guessColumns } from '../src/lib/csv.js';
import {
  buildHierarchy,
  flattenTree,
  expandToLeaves,
  compactCodes,
  leafCodesOf,
  assignAutoLevels,
  buildAutoHierarchy,
  synthesizeMissingParents,
} from '../src/lib/hierarchy.js';
import {
  buildCrosswalkRows,
  crosswalkToCsv,
  buildSourceToNameRows,
  sourceToNameCsv,
  buildNameToTargetRows,
  nameToTargetCsv,
} from '../src/lib/crosswalk.js';
import { buildZip } from '../src/lib/zip.js';
import {
  addGroup,
  markNoMatch,
  renameGroup,
  updateGroupNote,
  addCodesToGroup,
  removeCodesFromGroup,
  removeMapping,
  isNoMatch,
  mappings,
  mappingCounts,
  systemA as systemAStore,
  systemB as systemBStore,
  makeSystem,
  uniqueMappingOnly,
} from '../src/lib/stores.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(cond, msg) {
  console.log((cond ? '✓ ' : '❌ FAIL: ') + msg);
  if (!cond) failures++;
}

const naicsCsv = readFileSync(resolve(root, 'samples/naics-sample.csv'), 'utf8');
const naceCsv = readFileSync(resolve(root, 'samples/nace-sample.csv'), 'utf8');
const naics2022Csv = readFileSync(resolve(root, 'samples/2022_NAICS_Descriptions.csv'), 'utf8');

const A = await parseCsv(naicsCsv);
const B = await parseCsv(naceCsv);

// --- column guessing ---
const gA = guessColumns(A.fields, A.rows);
check(gA.level === 'level', 'guesses the level column');
check(gA.code === 'code', 'guesses the code column');
check(gA.title === 'description', 'guesses the title column');
check(gA.description === null, 'no separate description column to guess when title is the only text column');

// A file with BOTH a short "Title" and a long-form "Description" column must guess
// title as Title, not let Description's longer average text win the title slot.
{
  const naics2022 = await parseCsv(naics2022Csv);
  const g2022 = guessColumns(naics2022.fields, naics2022.rows);
  check(g2022.level === 'pLevel', 'guesses the level column (pLevel)');
  check(g2022.code === 'Code', 'guesses the code column (Code)');
  check(g2022.title === 'Title', 'guesses the short Title column as title, not the longer Description column');
  check(g2022.description === 'Description', 'guesses the long-form Description column as description');
}
{
  // Synthetic check isolating the same title-vs-description scoring, independent
  // of any real sample file.
  const fields = ['level', 'code', 'title', 'description'];
  const rows = [
    { level: '1', code: 'x', title: 'Short label', description: 'A '.repeat(80) + 'much longer explanation.' },
  ];
  const g = guessColumns(fields, rows);
  check(g.title === 'title', 'an explicit "title" column wins over a longer "description" column');
  check(g.description === 'description', 'the longer "description" column is still guessed for the description slot');
}

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
const filtered = flattenTree(sysA.tree, new Set(), (n) => n.title.toLowerCase().includes('soybean'));
const fc = filtered.map((r) => r.node.code);
check(fc.includes('11111'), 'search "soybean" includes the matching leaf');
check(fc.includes('11') && fc.includes('111') && fc.includes('1111'), 'search keeps ancestors of a match');
check(!fc.includes('31'), 'search excludes unrelated subtrees');

// --- expandToLeaves: only leaf codes are meaningful for export; parents are for navigation ---
check(
  [...expandToLeaves(sysA.tree, ['11111'])].join(',') === '11111',
  'expanding a leaf code returns itself',
);
check(
  new Set(expandToLeaves(sysA.tree, ['1111'])).size === 2 &&
    [...expandToLeaves(sysA.tree, ['1111'])].sort().join(',') === '11111,11112',
  'expanding a parent returns its leaf descendants (1111 -> 11111,11112)',
);
check(
  [...expandToLeaves(sysA.tree, ['11'])].sort().join(',') === '11111,11112,11121,11211',
  'expanding a higher ancestor returns every leaf beneath it (11 -> 4 leaves)',
);
check(
  [...expandToLeaves(sysA.tree, ['1111', '1112'])].sort().join(',') === '11111,11112,11121',
  'expanding multiple codes unions their leaves without duplicates',
);

// --- compactCodes: the inverse — display back the highest ancestor that's fully covered ---
check(
  compactCodes(sysA.tree, new Set(['11111', '11112'])).join(',') === '1111',
  'selecting exactly all of a parent’s leaf children collapses display to that parent (1111)',
);
check(
  compactCodes(sysA.tree, new Set(['11111', '11112', '11121'])).join(',') === '111',
  'full coverage of a higher ancestor collapses further up (111)',
);
check(
  compactCodes(sysA.tree, new Set(['11111'])).join(',') === '11111',
  'a lone leaf code is always its own trivial "full coverage"',
);
{
  const partial = compactCodes(sysA.tree, new Set(['11111', '11211'])).sort();
  check(
    partial.join(',') === '11111,112',
    `partial coverage keeps the uncovered leaf and collapses the fully-covered branch (got ${partial.join(',')})`,
  );
}

// --- mapping groups: creating a many-to-many link makes ONE group, storing only leaf codes ---
const naicsSoyLeaves = [...expandToLeaves(sysA.tree, ['11111'])]; // already a leaf
const naceGrainLeaves = [...expandToLeaves(sysB.tree, ['01.11', '01.13'])];
addGroup(naicsSoyLeaves, naceGrainLeaves, 'Soybean Farming', 'batch');
check(get(mappings).length === 1, 'creating a many-to-many link creates a single group, not N rows');
{
  const g = get(mappings)[0];
  check(g.sourceLeafCodes.join(',') === '11111', 'group stores the expanded leaf source codes');
  check(g.targetLeafCodes.sort().join(',') === '01.11,01.13', 'group stores the expanded leaf target codes (2 targets)');
  check(!isNoMatch(g), 'a group with codes on both sides is not a no-match entry');
}

// A parent-level selection on the source side (1111 -> its 2 leaf children) still
// produces ONE group whose leaves are the expansion, per the leaf-only-export rule.
const naicsOilseedLeaves = [...expandToLeaves(sysA.tree, ['1111'])];
addGroup(naicsOilseedLeaves, [...expandToLeaves(sysB.tree, ['10.61'])], 'Oilseed and Grain Farming');
{
  const g = get(mappings).find((x) => x.name === 'Oilseed and Grain Farming');
  check(g.sourceLeafCodes.sort().join(',') === '11111,11112', 'selecting a parent expands to its leaf children for storage');
  check(
    compactCodes(sysA.tree, new Set(g.sourceLeafCodes)).join(',') === '1111',
    'that group’s source side displays back as the compact parent code (1111), not two leaves',
  );
}

// --- rename + note ---
{
  const g = get(mappings)[0];
  renameGroup(g.id, 'Soybean farming (renamed)');
  updateGroupNote(g.id, 'reviewed');
  const updated = get(mappings).find((x) => x.id === g.id);
  check(updated.name === 'Soybean farming (renamed)', 'renameGroup updates the group name');
  check(updated.note === 'reviewed', 'updateGroupNote updates the group note');
}

// --- drag a code from a tree panel onto an existing group ---
{
  const g = get(mappings)[0]; // Soybean farming (renamed): source 11111, target 01.11/01.13
  const before = g.targetLeafCodes.length;
  addCodesToGroup(g.id, 'target', [...expandToLeaves(sysB.tree, ['01.41'])]);
  const after = get(mappings).find((x) => x.id === g.id);
  check(after.targetLeafCodes.length === before + 1, 'dragging a code onto a group adds it to that side');
  check(after.targetLeafCodes.includes('01.41'), 'the dragged leaf code is present on the group');
}

// --- remove a single code (bubble) from a group ---
{
  const g = get(mappings)[0];
  removeCodesFromGroup(g.id, 'target', ['01.41']);
  const after = get(mappings).find((x) => x.id === g.id);
  check(!after.targetLeafCodes.includes('01.41'), 'removing a bubble drops just that leaf code');
  check(after.targetLeafCodes.length === 2, 'the group’s other codes are untouched');
}

// Removing every code on both sides of a group drops the group entirely.
{
  addGroup(['54151'], ['62.01'], 'temp');
  const g = get(mappings).find((x) => x.name === 'temp');
  const before = get(mappings).length;
  removeCodesFromGroup(g.id, 'source', ['54151']);
  removeCodesFromGroup(g.id, 'target', ['62.01']);
  check(get(mappings).length === before - 1, 'a group with no codes left on either side is dropped entirely');
}

// --- no-match (both sides) + dedupe against real mappings ---
const nm1 = markNoMatch('source', ['54151'], 'Computer Systems Design and Related Services');
check(nm1.added === 1, 'a source code can be marked no match');
const nmGroup = get(mappings).find((g) => g.sourceLeafCodes.includes('54151'));
check(isNoMatch(nmGroup), 'a one-sided group is reported as no-match');

const nm2 = markNoMatch('target', ['62.01'], 'Computer programming activities');
check(nm2.added === 1, 'a target code can be marked no match');

const nm3 = markNoMatch('source', ['11111'], 'dup'); // already mapped
check(nm3.added === 0 && nm3.skipped === 1, 'no-match is skipped for an already-mapped code');

// A real mapping added later removes (or shrinks) an existing no-match entry for that code.
addGroup(['54151'], ['69.20'], 'Computer Systems Design and Related Services');
check(
  !get(mappings).some((g) => isNoMatch(g) && g.sourceLeafCodes.includes('54151')),
  'adding a real mapping drops the code’s prior no-match flag',
);

// --- mappingCounts aggregates leaf mapping "weight" up through ancestor codes ---
systemAStore.set(sysA);
systemBStore.set(sysB);
{
  const counts = get(mappingCounts);
  check(counts.source.get('11111') >= 1, 'a mapped leaf shows a non-zero count');
  check(counts.source.get('1111') >= counts.source.get('11111'), 'an ancestor aggregates its descendants’ counts');
  check(counts.noMatchTarget.has('62.01'), 'a no-match leaf code is tracked separately for badge rendering');
}

// --- export, mode A: single CSV with the N×N cross-product per group ---
const rows = buildCrosswalkRows(get(mappings), sysA, sysB);
const soy = rows.find((r) => r.source_code === '11111' && r.target_code === '01.11');
check(soy.source_title === 'Soybean Farming', 'crosswalk joins the source title');
check(soy.target_title.includes('cereals'), 'crosswalk joins the target title');
const noMatchRow = rows.find((r) => r.source_code === '' && r.target_code === '62.01');
check(noMatchRow && noMatchRow.target_title.includes('programming'), 'no-match row exports blank source + populated target');
const header = crosswalkToCsv(rows).split(/\r?\n/)[0];
check(
  header === 'source_code,source_title,target_code,target_title,group_name,note',
  'exported single-file CSV has the expected 6-column header',
);

// --- export, mode B: two files (source leaf -> group name, group name -> target leaf) ---
const sourceRows = buildSourceToNameRows(get(mappings), sysA);
const targetRows = buildNameToTargetRows(get(mappings), sysB);
check(
  sourceRows.some((r) => r.source_code === '11111' && r.group_name === 'Soybean farming (renamed)'),
  'source-to-name file maps each source leaf to its group name',
);
check(
  !sourceRows.some((r) => r.group_name === 'Computer programming activities'),
  'source-to-name file has no rows for a target-only (no-match) group',
);
check(
  targetRows.some((r) => r.target_code === '01.11' && r.group_name === 'Soybean farming (renamed)'),
  'name-to-target file maps each group name to its target leaves',
);
check(
  sourceToNameCsv(sourceRows).split(/\r?\n/)[0] === 'source_code,source_title,group_name',
  'source-to-name CSV has the expected 3-column header',
);
check(
  nameToTargetCsv(targetRows).split(/\r?\n/)[0] === 'group_name,target_code,target_title',
  'name-to-target CSV has the expected 3-column header',
);

// --- removeMapping still drops a whole group by id ---
{
  const before = get(mappings).length;
  const victim = get(mappings)[0];
  removeMapping(victim.id);
  check(get(mappings).length === before - 1, 'removeMapping drops the whole group');
}

// --- hierarchy warnings ---
const bad = buildHierarchy(
  [
    { level: '2', code: 'x', description: 'child before any parent' },
    { level: '1', code: 'y', description: 'root' },
  ],
  { level: 'level', code: 'code', title: 'description' },
);
check(bad.roots.length === 2, 'a child before any parent becomes its own root');
const dupCode = buildHierarchy(
  [
    { level: '1', code: 'z', description: 'a' },
    { level: '1', code: 'z', description: 'b' },
  ],
  { level: 'level', code: 'code', title: 'description' },
);
check(dupCode.warnings.some((w) => w.includes('duplicate')), 'duplicate code produces a warning');

// --- title/description column rename: title is required+short, description is optional+long ---
const withDesc = buildHierarchy(
  [{ level: '1', code: 'w', description: 'Widgets', description2: 'A long explanation of widgets.' }],
  { level: 'level', code: 'code', title: 'description', description: 'description2' },
);
check(withDesc.byCode.get('w').title === 'Widgets', 'node.title comes from the mapped title column');
check(
  withDesc.byCode.get('w').description === 'A long explanation of widgets.',
  'node.description comes from the optional mapped description column',
);
const noDesc = buildHierarchy(
  [{ level: '1', code: 'w', description: 'Widgets' }],
  { level: 'level', code: 'code', title: 'description', description: null },
);
check(noDesc.byCode.get('w').description === '', 'node.description is blank when no description column is mapped');

// --- leafCodesOf: every childless code, used for mapping-progress bars ---
{
  const leaves = leafCodesOf(sysA.tree).sort();
  check(leaves.length === 10, `leafCodesOf returns only the 10 childless NAICS codes (got ${leaves.length})`);
  check(!leaves.includes('11') && !leaves.includes('111'), 'leafCodesOf excludes ancestor codes');
  check(leaves.includes('11111'), 'leafCodesOf includes actual leaf codes');
}

// --- uniqueMappingOnly: restrict each leaf code to one group per side ---
{
  uniqueMappingOnly.set(true);

  const r1 = addGroup(['31111'], ['11.05'], 'Test unique A');
  check(
    r1.skippedSource.length === 0 && r1.skippedTarget.length === 0,
    'first use of a fresh code on each side is never skipped',
  );
  const groupA = get(mappings).find((g) => g.name === 'Test unique A');
  check(groupA.sourceLeafCodes.includes('31111'), 'group A claims source code 31111');

  const r2 = addGroup(['31111'], ['11.07'], 'Test unique B');
  check(r2.skippedSource.join(',') === '31111', 'reusing 31111 on the source side is skipped while the toggle is on');
  check(r2.skippedTarget.length === 0, 'the target side (11.07, unused) is unaffected');
  const groupB = get(mappings).find((g) => g.name === 'Test unique B');
  check(
    groupB.sourceLeafCodes.length === 0 && groupB.targetLeafCodes.includes('11.07'),
    'group B is still created as a target-only entry once its source code is filtered out',
  );
  check(isNoMatch(groupB), 'a group left with codes on only one side reads as no-match');

  const drop1 = addCodesToGroup(groupB.id, 'source', ['31111']);
  check(
    drop1.skipped.join(',') === '31111' && !get(mappings).find((g) => g.id === groupB.id).sourceLeafCodes.includes('31111'),
    'dragging an already-claimed code onto a *different* group is skipped, not added',
  );
  const drop2 = addCodesToGroup(groupA.id, 'source', ['31111']);
  check(
    drop2.skipped.length === 0,
    're-adding a code to the group that already owns it is a harmless no-op, not a conflict',
  );

  uniqueMappingOnly.set(false);
  const r3 = addGroup(['31111'], ['10.91'], 'Test unique C');
  check(
    r3.skippedSource.length === 0,
    'with the toggle off, a code already used elsewhere can be reused freely',
  );
  const groupC = get(mappings).find((g) => g.name === 'Test unique C');
  check(groupC.sourceLeafCodes.includes('31111'), 'group C also claims 31111 once the restriction is disabled');
}

// --- auto level detection: infer hierarchy depth from code structure alone ---
check(
  assignAutoLevels([{ c: '11' }, { c: '111' }, { c: '1111' }], 'c').join(',') === '1,2,3',
  'assignAutoLevels ranks codes by length when none contain a "."',
);
check(
  assignAutoLevels([{ c: 'A' }, { c: '01' }, { c: '01.1' }, { c: '01.11' }], 'c').join(',') === '1,2,3,4',
  'assignAutoLevels ranks by dot-count (with a length tiebreak for equal dot-counts) once any code has a "."',
);
{
  const autoA = buildAutoHierarchy(A.rows, { code: gA.code, title: gA.title });
  check(autoA.warnings.length === 0, `auto-detected NAICS hierarchy builds with no warnings (${autoA.warnings.join('; ')})`);
  check(autoA.byCode.get('11111').parent === '1111', 'auto-detected (length-based) NAICS: 11111 nests under 1111');
  check(autoA.byCode.get('1111').parent === '111', 'auto-detected NAICS: 1111 nests under 111');
  check(autoA.byCode.get('11').parent === null, 'auto-detected NAICS: 11 is a root');
  check(autoA.roots.length === sysA.tree.roots.length, 'auto-detected NAICS has the same root count as the explicit-level tree');
}
{
  const gB = guessColumns(B.fields, B.rows);
  const autoB = buildAutoHierarchy(B.rows, { code: gB.code, title: gB.title });
  check(autoB.byCode.get('A').parent === null, 'auto-detected (dot-based) NACE: letter section A is a root');
  check(autoB.byCode.get('01').parent === 'A', 'auto-detected NACE: 01 nests under section A');
  check(autoB.byCode.get('01.1').parent === '01', 'auto-detected NACE: 01.1 nests under 01');
  check(autoB.byCode.get('01.11').parent === '01.1', 'auto-detected NACE: 01.11 nests under 01.1');
}

// --- synthesizeMissingParents: fill in ancestor codes implied by structure but absent ---
{
  const rows = [
    { c: '01.a', t: 'Sub A' },
    { c: '01.b', t: 'Sub B' },
  ];
  const synthesized = synthesizeMissingParents(rows, { code: 'c', title: 't' });
  check(synthesized.length === 3, `synthesis adds exactly the one missing parent "01" (got ${synthesized.length} rows)`);
  check(synthesized[0].c === '01', 'the synthesized parent sorts before its children (shallowest first)');
  const tree = buildAutoHierarchy(synthesized, { code: 'c', title: 't' });
  check(tree.byCode.get('01.a').parent === '01', 'after synthesis, 01.a nests under the generated 01');
  check(tree.byCode.get('01.b').parent === '01', 'after synthesis, 01.b nests under the generated 01');
  check(tree.byCode.get('01').parent === null, 'the synthesized 01 is itself a root here');
}
{
  // An already-present parent is left untouched: nothing to synthesize, same reference back.
  const rows = [
    { c: '01', t: 'Section' },
    { c: '01.a', t: 'Sub A' },
  ];
  check(synthesizeMissingParents(rows, { code: 'c', title: 't' }) === rows, 'nothing is synthesized when the parent already exists');
}
{
  // Length-based convention: a specific branch missing two intermediate levels gets
  // both filled in, using the lengths already known from sibling branches (11/111/1111).
  const rows = [
    { c: '11', t: 'Root A' },
    { c: '111', t: 'Sub A' },
    { c: '1111', t: 'Sub AA' },
    { c: '31', t: 'Root B' },
    { c: '31111', t: 'Deep leaf missing 311 and 3111' },
  ];
  const synthesized = synthesizeMissingParents(rows, { code: 'c', title: 't' });
  const codes = synthesized.map((r) => r.c).sort();
  check(
    codes.join(',') === '11,111,1111,31,311,3111,31111',
    `length-based synthesis fills every missing intermediate level (got ${codes.join(',')})`,
  );
  const tree = buildAutoHierarchy(synthesized, { code: 'c', title: 't' });
  check(tree.byCode.get('31111').parent === '3111', 'deep leaf nests under the synthesized 3111');
  check(tree.byCode.get('3111').parent === '311', 'synthesized 3111 nests under synthesized 311');
  check(tree.byCode.get('311').parent === '31', 'synthesized 311 nests under the real 31');
}
{
  // buildAutoHierarchy's own synthesizeParents option composes end-to-end.
  const rows = [
    { c: '01.a', t: 'Sub A' },
    { c: '01.b', t: 'Sub B' },
  ];
  const withSynth = buildAutoHierarchy(rows, { code: 'c', title: 't' }, { synthesizeParents: true });
  check(withSynth.byCode.has('01'), 'buildAutoHierarchy({ synthesizeParents: true }) creates the missing "01" node');
  check(withSynth.byCode.get('01.a').parent === '01', 'and nests 01.a under the generated parent');

  const withoutSynth = buildAutoHierarchy(rows, { code: 'c', title: 't' });
  check(withoutSynth.roots.length === 2, 'without synthesis (the default), 01.a/01.b become their own orphan roots');
}

// --- regression: synthesis must not flatten multiple branches into document order ---
// A plain "shallowest first" sort of (real + synthesized) rows groups every branch's
// same-depth rows together across the whole file, which breaks buildHierarchy's
// "parent is the *nearest* preceding row with a smaller level" rule — every depth-2
// row across the entire dataset would nest under whichever depth-1 row sorts last,
// rather than its real parent.
{
  const rows = [
    { c: '11', t: 'Root A' },
    { c: '111', t: 'Sub A' },
    { c: '1111', t: 'Sub AA' },
    { c: '31', t: 'Root B' },
    { c: '31111', t: 'Deep leaf missing 311 and 3111' }, // forces synthesis of 311 and 3111
  ];
  const tree = buildAutoHierarchy(rows, { code: 'c', title: 't' }, { synthesizeParents: true });
  check(tree.byCode.get('111').parent === '11', 'branch A: 111 nests under its own root 11, not root B');
  check(tree.byCode.get('1111').parent === '111', 'branch A: 1111 nests under 111');
  check(tree.byCode.get('31111').parent === '3111', 'branch B: deep leaf nests under synthesized 3111');
  check(tree.roots.map((r) => r.code).sort().join(',') === '11,31', 'both original roots stay roots after synthesis');
}
{
  // The exact scenario reported: auto-detecting codes on the full 2022 NAICS
  // descriptions sample must not dump unrelated subsectors (111, 112, 113, ...)
  // under one unnamed synthesized parent.
  const naics2022 = await parseCsv(naics2022Csv);
  const g2022 = guessColumns(naics2022.fields, naics2022.rows);
  const tree = buildAutoHierarchy(
    naics2022.rows,
    { code: g2022.code, title: g2022.title },
    { synthesizeParents: true },
  );
  check(tree.byCode.get('111').parent === '11', '111 (Crop Production) nests under sector 11 (Agriculture)');
  check(tree.byCode.get('112').parent === '11', '112 (Animal Production) nests under sector 11 (Agriculture)');
  check(tree.byCode.get('113').parent === '11', '113 (Forestry and Logging) nests under sector 11 (Agriculture)');
  const sector11Children = (tree.childrenOf.get('11') ?? []).map((n) => n.code).sort();
  check(
    sector11Children.join(',') === '111,112,113,114,115',
    `sector 11 has only its own 5 real subsectors as children, not subsectors from other sectors (got ${sector11Children.join(',')})`,
  );

  // NAICS also uses hyphenated sector-range codes (a single top-level code
  // standing in for a run of sibling sector numbers, e.g. "31-33" for
  // Manufacturing) instead of one plain digit code per sector. A naive
  // string-length-based rank misclassifies these as much deeper nodes (their
  // hyphenated form is as long as a real 5-digit code) and truncation-based
  // synthesis then invents bogus bare-digit ancestors (e.g. a fabricated "49")
  // instead of recognizing they belong under the real range code.
  check(tree.byCode.get('31-33').parent === null, '"31-33" (Manufacturing) is a top-level root, not nested');
  check(tree.byCode.get('44-45').parent === null, '"44-45" (Retail Trade) is a top-level root, not nested');
  check(tree.byCode.get('48-49').parent === null, '"48-49" (Transportation and Warehousing) is a top-level root, not nested');
  check(tree.byCode.get('311').parent === '31-33', '311 (a real subsector) nests under the range code "31-33", not a bare "31"');
  check(tree.byCode.get('331').parent === '31-33', '331 nests under "31-33" too — same range, different plain prefix');
  check(tree.byCode.get('441').parent === '44-45', '441 nests under the range code "44-45"');
  check(tree.byCode.get('481').parent === '48-49', '481 nests under the range code "48-49"');
  check(tree.byCode.get('491').parent === '48-49', '491 nests under "48-49" too, not a fabricated bare "49"');
  check(!tree.byCode.has('48'), 'no bogus bare "48" node is synthesized');
  check(!tree.byCode.has('49'), 'no bogus bare "49" node is synthesized');
  check(!tree.byCode.has('31'), 'no bogus bare "31" node is synthesized');
  const roots = tree.roots.map((r) => r.code).sort();
  check(roots.length === 20, `the full NAICS 2022 sample has exactly its real 20 sectors as roots (got ${roots.length})`);
}

// --- regression: synthesized/auto-detected codes must be sorted into their
// natural position among siblings, not tacked on after every existing code
// (they're only ever appended to the end of the internal working list, so
// without an explicit sort they'd always render last regardless of value). ---
{
  const rows = [
    { c: '31', t: 'Root B' },
    { c: '3112', t: 'higher-numbered child of missing 311, listed first in the file' },
    { c: '11', t: 'Root A' },
    { c: '111', t: 'unrelated real length-3 code (just establishes that depth exists)' },
    { c: '3111', t: 'lower-numbered child of missing 311, listed second in the file' },
  ];
  const tree = buildAutoHierarchy(rows, { code: 'c', title: 't' }, { synthesizeParents: true });
  check(tree.byCode.has('311'), 'synthesis still creates the missing intermediate "311"');
  check(
    tree.roots.map((r) => r.code).join(',') === '11,31',
    `roots are sorted (11 before 31) even though "31" appeared first in the file (got ${tree.roots.map((r) => r.code).join(',')})`,
  );
  const synthesizedSiblings = (tree.childrenOf.get('311') ?? []).map((n) => n.code);
  check(
    synthesizedSiblings.join(',') === '3111,3112',
    `311's children are sorted (3111 before 3112) even though "3112" appeared first in the file (got ${synthesizedSiblings.join(',')})`,
  );
}

// --- buildZip: dependency-free ZIP writer used by the single-export-button flow ---
{
  /** Minimal STORE-method zip reader, sufficient to round-trip what buildZip writes. */
  function readZipEntries(buffer) {
    const entries = {};
    let offset = 0;
    while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
      const size = buffer.readUInt32LE(offset + 18);
      const nameLen = buffer.readUInt16LE(offset + 26);
      const extraLen = buffer.readUInt16LE(offset + 28);
      const nameStart = offset + 30;
      const name = buffer.toString('utf8', nameStart, nameStart + nameLen);
      const dataStart = nameStart + nameLen + extraLen;
      entries[name] = buffer.toString('utf8', dataStart, dataStart + size);
      offset = dataStart + size;
    }
    return entries;
  }

  const blob = buildZip([
    { name: 'a.csv', content: 'x,y\n1,2\n' },
    { name: 'b.csv', content: 'hello,world\n' + 'z'.repeat(1000) },
  ]);
  const buffer = Buffer.from(await blob.arrayBuffer());
  check(buffer.readUInt32LE(0) === 0x04034b50, 'zip starts with a valid local file header signature');
  const entries = readZipEntries(buffer);
  check(Object.keys(entries).join(',') === 'a.csv,b.csv', 'zip contains both entries by name');
  check(entries['a.csv'] === 'x,y\n1,2\n', 'first entry round-trips its exact content');
  check(entries['b.csv'] === 'hello,world\n' + 'z'.repeat(1000), 'second (larger) entry round-trips its exact content');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll logic checks passed.');
process.exit(failures ? 1 : 0);
