import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';

const A = 'samples/naics-sample.csv';
const B = 'samples/nace-sample.csv';

/** Simulate a native HTML5 drag-and-drop between two locators (Playwright's
 * mouse-based dragTo doesn't reliably fire dragstart/dragover/drop). */
async function dragAndDrop(sourceLocator, targetLocator) {
  const source = await sourceLocator.elementHandle();
  const target = await targetLocator.elementHandle();
  await sourceLocator.page().evaluate(
    ([src, tgt]) => {
      const dataTransfer = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    },
    [source, target],
  );
}

/** Click the toolbar's Export button, agree to the citation prompt, confirm the
 * modal's own Export button, and resolve with the triggered download. */
async function exportViaCiteModal(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export crosswalk (.csv)' }).click();
      await page.getByLabel('I agree to credit Crosswalk Generator when using this data.').check();
      await page.locator('.help-modal').getByRole('button', { name: 'Export' }).click();
    })(),
  ]);
  return download;
}

test('build hierarchies, map codes as groups, persist, and export a crosswalk', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Scoped to the toolbar title specifically — the footer also mentions
  // "Crosswalk Generator" in passing, which would otherwise make this an
  // ambiguous (multi-element) locator.
  await expect(page.locator('.toolbar .name', { hasText: 'Crosswalk Generator' })).toBeVisible();

  // --- Upload both systems. Each panel's file input unmounts once its tree is
  // built, so take the first remaining CSV input for each upload. ---
  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await expect(csvInput).toHaveCount(2);

  await csvInput.first().setInputFiles(A);
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // treat it as "parent codes already included" rather than auto-generating
  // (which would otherwise wrap every real ancestor in a "<code> (group)" node).
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await expect(page.locator('.panel[data-accent="A"] .name-label')).toBeVisible(); // NAICS

  await csvInput.first().setInputFiles(B);
  // nace-sample.csv is likewise already fully populated with every ancestor level.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await expect(page.locator('.panel[data-accent="B"] .name-label')).toBeVisible(); // NACE

  // --- Progress bars start at 0 of the 10 leaf codes in each sample system. ---
  await expect(page.locator('.progress-label').nth(0)).toHaveText('0 / 10 mapped');
  await expect(page.locator('.progress-label').nth(1)).toHaveText('0 / 10 mapped');

  // Correct nesting: expand-all and confirm a deep code is visible, and that
  // the full row count (including ancestor/parent rows, not just leaves) was
  // kept — the panel header only ever shows the leaf-based "N of M mapped"
  // count, never a separate total-node count, so this is the only place that
  // number is still checked.
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();
  await expect(page.locator('.node', { hasText: '01.11' }).first()).toBeVisible();
  await expect(page.locator('.panel[data-accent="A"] .node')).toHaveCount(26); // NAICS
  await expect(page.locator('.panel[data-accent="B"] .node')).toHaveCount(25); // NACE

  // --- No relation/match-type dropdown anywhere in the mapping bar. ---
  await expect(page.locator('select[aria-label="Relationship type"]')).toHaveCount(0);

  // --- Many-to-many creates ONE group row, not N rows. ---
  // (01.11 and 01.41 sit under different immediate parents, so neither fully
  // covers a parent's leaves — no display-compaction merges them into one bubble.)
  await page.locator('.node', { hasText: '11111' }).first().click(); // Soybean Farming (source, leaf)
  await page.locator('.node', { hasText: '01.11' }).first().click(); // target 1
  await page.locator('.node', { hasText: '01.41' }).first().click(); // target 2
  const link = page.getByRole('button', { name: 'Group' });
  await expect(link).toBeEnabled();
  await link.click();

  await expect(page.locator('.list header h3 .count')).toHaveText('1'); // one group, not two rows
  await expect(page.locator('.row')).toHaveCount(1);
  const row = page.locator('.row').first();
  await expect(row.locator('.pair > .side').first().locator('.bubble')).toHaveCount(1); // source: 11111
  await expect(row.locator('.pair > .side').nth(1).locator('.bubble')).toHaveCount(2); // target: 01.11, 01.13
  // Selections clear after linking; source badge now shows a count.
  await expect(page.locator('.node.selected')).toHaveCount(0);

  // --- Mapped codes are greyed out in the tree (no "hide mapped" toggle anymore). ---
  await expect(page.locator('.node', { hasText: '11111' }).first()).toHaveClass(/mapped/);
  await expect(page.locator('.progress-label').nth(0)).toHaveText('1 / 10 mapped');
  await expect(page.locator('.progress-label').nth(1)).toHaveText('2 / 10 mapped');

  // --- Clicking a parent (incomplete) node selects its not-yet-mapped leaves,
  // instead of toggling the parent's own selection. ---
  await page.locator('.node', { hasText: '1111' }).first().click();
  // 1111's leaves are 11111 (already mapped, skipped) and 11112 (unmapped, selected).
  await expect(page.locator('.node.selected')).toHaveCount(1);
  await expect(page.locator('.node.selected', { hasText: '11112' })).toBeVisible();
  await page.locator('.panel[data-accent="A"] .selcount .linky').click();
  await expect(page.locator('.node.selected')).toHaveCount(0);

  // --- Group names are not editable or displayed in the Mappings pane (they're
  // just the concatenation of the codes already shown as bubbles). ---
  await expect(row.getByRole('button', { name: /^Rename/ })).toHaveCount(0);
  await expect(row.locator('.name-label')).toHaveCount(0);

  // --- Remove a single code (bubble) from the group without deleting the row. ---
  await row.locator('.bubble', { hasText: '01.41' }).locator('.bubble-x').click();
  await expect(row.locator('.pair > .side').nth(1).locator('.bubble')).toHaveCount(1);
  await expect(page.locator('.row')).toHaveCount(1); // group still exists (target side not empty)

  // --- Drag a code from the tree onto the existing group to add it. ---
  await dragAndDrop(page.locator('.node', { hasText: '31111' }).first(), row.locator('.pair > .side').first());
  await expect(row.locator('.pair > .side').first().locator('.bubble')).toHaveCount(2); // 11111, 31111

  // --- Hovering a mapped code in a tree panel highlights its group in the Mappings pane,
  // and specifically the bubble for *that* code (the A side now has two bubbles:
  // 11111, and 31111 compacted up to its lone-child parent 3111 — only the
  // hovered code's own bubble should light up, not the other one). ---
  const bubble11111 = row.locator('.bubble', { hasText: '11111' });
  const bubble3111 = row.locator('.bubble', { hasText: '3111' });
  await expect(row).not.toHaveClass(/highlighted/);
  await expect(bubble11111).not.toHaveClass(/bubble-highlighted/);
  await page.locator('.node', { hasText: '11111' }).first().hover();
  await expect(row).toHaveClass(/highlighted/);
  await expect(bubble11111).toHaveClass(/bubble-highlighted/);
  await expect(bubble3111).not.toHaveClass(/bubble-highlighted/);
  await page.locator('.node', { hasText: '11111' }).first().dispatchEvent('mouseleave');
  await expect(row).not.toHaveClass(/highlighted/);
  await expect(bubble11111).not.toHaveClass(/bubble-highlighted/);

  // --- Hovering an *ancestor* of a mapped leaf (not the leaf itself) also
  // highlights the group — the ancestor shows an aggregated mapping badge, so it
  // must behave the same as hovering the leaf directly. ---
  await page.locator('.node', { hasText: '1111' }).first().hover(); // 1111 is 11111's parent
  await expect(row).toHaveClass(/highlighted/);
  await page.locator('.node', { hasText: '1111' }).first().dispatchEvent('mouseleave');
  await expect(row).not.toHaveClass(/highlighted/);

  // --- No match (source side only) creates its own group/row. ---
  await page.locator('.node', { hasText: '54151' }).first().click();
  const noMatchBtn = page.getByRole('button', { name: /Mark 1 as no match/ });
  await expect(noMatchBtn).toBeVisible();
  await noMatchBtn.click();
  // 5415 is 54151's sole parent (they share a description in this sample), so the
  // Mappings pane displays the compacted parent code "5415", not the leaf "54151" —
  // per the parent-code-for-brevity rule.
  await expect(page.locator('.row.nomatch', { hasText: '5415' })).toBeVisible();
  await expect(page.locator('.row')).toHaveCount(2);
  // 5415 is now 100% "mapped" (no-match counts) and auto-collapsed, hiding its
  // leaf — reopen it to confirm the tree still shows the real leaf 54151.
  await page.locator('.node', { hasText: /\b5415\b/ }).locator('.twist').click();
  await expect(page.locator('.node', { hasText: '54151' }).locator('.badge.nomatch')).toBeVisible();

  // --- Persistence across reload. ---
  await page.reload();
  await expect(page.locator('.list header h3 .count')).toHaveText('2');
  await expect(page.locator('.row').first().locator('.pair > .side').first().locator('.bubble')).toHaveCount(2);

  // --- Export: a single CSV, one row per code across every mapping group. ---
  const systemNameA = (await page.locator('.panel[data-accent="A"] .name-label').textContent())?.trim();
  const systemNameB = (await page.locator('.panel[data-accent="B"] .name-label').textContent())?.trim();
  const download = await exportViaCiteModal(page);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv.split(/\r?\n/)[0]).toBe('group_number,system,system_name,code,title,description,relationship,note');
  const parsedCsv = Papa.parse(csv, { header: true }).data;

  // The soybean group's A leaf (11111) and B leaf (01.11) are separate rows
  // sharing one group_number, not a single combined row. `system` is the
  // literal A/B side; `system_name` is that side's own dataset name.
  const soyA = parsedCsv.find((r) => r.system === 'A' && r.code === '11111');
  const soyB = parsedCsv.find((r) => r.system === 'B' && r.code === '01.11');
  expect(soyA.system_name).toBe(systemNameA);
  expect(soyB.system_name).toBe(systemNameB);
  expect(soyA.title).toBe('Soybean Farming');
  expect(soyA.group_number).toBe(soyB.group_number);
  expect(soyA.relationship).toBe('equal'); // "equal" by default, not toggled to approximate

  // No-match row: only a row under its own system, blank relationship, and
  // (per the "distinct row per no-match code" rule) its own code as the note-free
  // relationship marker rather than any pairing.
  const noMatchExportRow = parsedCsv.find((r) => r.code === '54151');
  expect(noMatchExportRow.system).toBe('A');
  expect(parsedCsv.some((r) => r.code === '54151' && r.system === 'B')).toBe(false);
  expect(noMatchExportRow.relationship).toBe('');

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('a "System A"/"System B" label is always visible, before and after a dataset is loaded', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Before upload, the setup panel's own heading already reads "System A"/"System B".
  await expect(page.locator('.setup[data-accent="A"] .setup-head')).toHaveText('System A');
  await expect(page.locator('.setup[data-accent="B"] .setup-head')).toHaveText('System B');

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  // Once loaded, the tree panel shows the dataset's own custom name as the
  // main heading, so a small "System A" label stays visible alongside it.
  await expect(page.locator('.panel[data-accent="A"] .side-label')).toHaveText('System A');
  await expect(page.locator('.panel[data-accent="A"] .name-label')).toBeVisible();
});

test('the demo-data banner loads a demo pair into both panels in one click, and disappears once loaded', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // The banner offers a single one-click action that loads both sides at
  // once — no per-side dataset picker anymore, and no column-mapping step.
  const banner = page.locator('.demo-banner');
  await expect(banner).toBeVisible();
  await expect(page.getByRole('button', { name: 'Build hierarchy' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Try our demo data' }).click();
  await expect(page.getByRole('button', { name: 'Build hierarchy' })).toHaveCount(0);
  await expect(page.locator('.panel[data-accent="A"] .name-label')).toHaveText('NAICS industry classification system');
  await expect(page.locator('.panel[data-accent="B"] .name-label')).toHaveText('NACE industry classification system');

  // Disappears on its own once data is loaded, without needing its dismiss button.
  await expect(banner).toHaveCount(0);
});

test('the demo-data banner has no dismiss button and reappears once both systems go back to empty', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const banner = page.locator('.demo-banner');
  await expect(banner).toBeVisible();
  await expect(page.locator('.demo-banner .demo-dismiss')).toHaveCount(0);

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await expect(banner).toHaveCount(0); // gone as soon as one side has data

  // Regression: the banner used to stay gone for the rest of the session once
  // dismissed/loaded once, via a permanent "dismissed" flag. Now there is no
  // such flag — the banner is purely "neither system has data yet", so it
  // must come back as soon as that becomes true again, e.g. after Replace
  // file clears system A back to the upload step (system B was never loaded).
  await page.locator('.panel[data-accent="A"] .danger.small', { hasText: 'Replace file…' }).click();
  await expect(banner).toBeVisible();
});

test('Restart brings the demo-data banner back', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const banner = page.locator('.demo-banner');
  await expect(banner).toBeVisible();

  await page.getByRole('button', { name: 'Try our demo data' }).click();
  await expect(banner).toHaveCount(0);

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Restart' }).click();
  await expect(banner).toBeVisible();
});

test('the full NAICS 2022 sample (loaded via the demo banner) auto-nests without dumping subsectors under a stray parent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole('button', { name: 'Try our demo data' }).click();
  await expect(page.locator('.panel[data-accent="A"] .name-label')).toBeVisible();

  for (const b of await page.locator('.panel[data-accent="A"] .controls button', { hasText: 'Expand' }).all()) {
    await b.click();
  }
  // 111 (Crop Production) must nest under its real sector 11 (Agriculture), not
  // under some unrelated synthesized ancestor.
  const sector11 = page.locator('.panel[data-accent="A"] .node', { hasText: '11' }).first();
  await expect(sector11).toBeVisible();
  await expect(page.locator('.panel[data-accent="A"] .node', { hasText: '111' }).first()).toBeVisible();
  // The Title column (short label), not the long-form Description, drives the
  // visible node text.
  await expect(page.locator('.panel[data-accent="A"] .node', { hasText: 'Crop Production' }).first()).toBeVisible();

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('"select unmapped" compacts to the topmost code and auto-expands so the selection is visible', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // treat it as "parent codes already included" rather than auto-generating
  // (which would otherwise wrap every real ancestor in a "<code> (group)" node).
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  // nace-sample.csv is likewise already fully populated with every ancestor level.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  const panelA = page.locator('.panel[data-accent="A"]');
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // Map just 11111 (one of 11's four leaves), leaving the rest of sector 11 unmapped.
  await panelA.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();

  // Sector 11's shape: 111 -> {1111 -> [11111 (mapped), 11112], 1112 -> [11121]},
  // 112 -> 1121 -> [11211]. Only 11112 is a lone unmapped leaf under a partially
  // mapped branch (1111); 1112 and 112 are *entirely* unmapped, so they should
  // compact all the way up to themselves. 1112 (a child of 111, two levels down)
  // is not rendered at all right now. (.node's text starts with the
  // expand/collapse arrow, so the code is matched with both-side word
  // boundaries — not anchored to the very start — so "1112" doesn't also match
  // as a substring of "11112".)
  const node11112 = panelA.locator('.node', { hasText: /\b11112\b/ });
  const node1112 = panelA.locator('.node', { hasText: /\b1112\b/ });
  const node112 = panelA.locator('.node', { hasText: /\b112\b/ });
  await panelA.locator('.controls button', { hasText: 'Collapse' }).click();
  await expect(node1112).toHaveCount(0);

  // Click the (collapsed, not-yet-expanded) root sector 11 itself — a node with
  // children is never individually selected; clicking it selects its unmapped
  // leaves instead (there's no separate "select unmapped" button anymore).
  const root11 = panelA.locator('.node', { hasText: /\b11\b/ });
  await expect(root11.locator('.select-unmapped')).toHaveCount(0);
  await root11.click();

  // The previously-hidden branch must now be visible (auto-expanded)...
  await expect(node1112).toBeVisible();
  await expect(node112).toBeVisible();
  // ...and the selection is compacted to the topmost fully-unmapped code at each
  // branch (11112, 1112, 112) rather than a pile of raw leaf codes.
  await expect(panelA.locator('.node.selected')).toHaveCount(3);
  await expect(node11112).toHaveClass(/selected/);
  await expect(node1112).toHaveClass(/selected/);
  await expect(node112).toHaveClass(/selected/);

  // Regression: a parent-level code that ended up selected (via the
  // select-unmapped compaction above) must deselect on a second click, just
  // like any other selected code — it must not re-run "select unmapped"
  // instead (which would leave it stuck selected with no way to click it off,
  // since everything under it is already selected/unmapped either way).
  await node112.click();
  await expect(node112).not.toHaveClass(/selected/);
  await expect(panelA.locator('.node.selected')).toHaveCount(2);
});

test('auto-detect level builds a hierarchy without picking a level column', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  // The level dropdown starts on "Auto-detect from code structure" by
  // default, so no column needs to be picked here.
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // it's a "parent codes already included" dataset — auto-generating parent
  // codes (the default) would treat every real ancestor code as colliding
  // with itself and wrap it in a spurious "<code> (group)" node.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();
  // Auto-detected (length-based) levels reproduce the same nesting as the explicit level column.
  await expect(page.locator('.node', { hasText: '11111' }).first()).toBeVisible();
  await expect(page.locator('.node')).toHaveCount(26); // still all 26 rows kept

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('the column-mapping step groups fields into "Select columns"/"Configure nesting", disables the level column until parent codes are confirmed included, and keeps its hint text static', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);

  await expect(page.getByRole('heading', { name: 'Select columns' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Configure nesting' })).toBeVisible();

  const parentCheckbox = page.getByLabel('Data includes parent codes');
  const levelSelect = page.getByLabel('Level column');
  const hint = page.locator('.mapper .hint');
  const hintText = await hint.textContent();

  // The level column can't do anything useful without an explicit row for
  // every ancestor level already in the file, so it stays disabled (and on
  // "Auto-detect") until the user confirms the file has that.
  await expect(parentCheckbox).not.toBeChecked();
  await expect(levelSelect).toBeDisabled();
  await expect(levelSelect).toHaveValue('');

  await parentCheckbox.check();
  await expect(levelSelect).toBeEnabled();

  // Regression: this hint used to swap to a different message depending on
  // the checkbox state, which read as the UI changing its mind mid-explanation.
  await expect(hint).toHaveText(hintText);

  // Unchecking disables the select again and resets it back to auto-detect,
  // since an explicit level column is no longer a valid choice.
  await levelSelect.selectOption({ index: 1 });
  await parentCheckbox.uncheck();
  await expect(levelSelect).toBeDisabled();
  await expect(levelSelect).toHaveValue('');
  await expect(hint).toHaveText(hintText);
});

test('column-mapping "?" hints use the fast custom tooltip, not the slow native title', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);

  const codeHelp = page.locator('.mapper label', { hasText: 'Code column' }).locator('.help');
  await expect(codeHelp).toHaveCount(1);
  await expect(codeHelp).not.toHaveAttribute('title');

  await codeHelp.hover();
  await expect(page.locator('.fast-tooltip')).toBeVisible();
  await expect(page.locator('.fast-tooltip')).toContainText('unique identifier');
});

test('auto-generate parent codes disambiguates a code that collides with an implied ancestor', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles({
    name: 'colliding.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('code,title\n20,Twenty\n20.w,Twenty W\n'),
  });
  // The level dropdown is already on "Auto-detect from code structure" by default.
  // Leave "Data includes parent codes" unchecked (the default, i.e. auto-generate):
  // "20" is both a real code and the natural ancestor of "20.w", so it's
  // "already taken" and should be replaced by a synthesized, blank-title
  // "20 (group)" node with both real codes nested under it as siblings.
  await expect(page.getByLabel('Data includes parent codes')).not.toBeChecked();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();
  // The synthesized "20 (group)" node is its own root, with the real "20" and
  // "20.w" nested under it as siblings (a blank title, so only its code shows).
  await expect(page.locator('.node .code', { hasText: '20 (group)' })).toBeVisible();
  await expect(page.locator('.node .code').filter({ hasText: /^20$/ })).toBeVisible();
  await expect(page.locator('.node .code', { hasText: '20.w' })).toBeVisible();

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('a code already mapped on one side can never be selected for a second mapping', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // treat it as "parent codes already included" rather than auto-generating
  // (which would otherwise wrap every real ancestor in a "<code> (group)" node).
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  // nace-sample.csv is likewise already fully populated with every ancestor level.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // There's no toggle for this anymore — a code can only ever belong to one
  // mapping per side.
  await expect(page.getByText('Only allow each code to be mapped once')).toHaveCount(0);

  // First group: 11111 <-> 01.11.
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();
  await expect(page.locator('.list header h3 .count')).toHaveText('1');

  // Clicking an already-mapped code must not select it at all (not silently
  // drop it later at Link time) — the click is refused outright. The node is
  // marked aria-disabled, so Playwright's normal actionability check would
  // itself refuse to click it; force the click to prove the app's own click
  // handler (not just the browser) rejects it.
  const mappedSource = page.locator('.node', { hasText: '11111' }).first();
  await expect(mappedSource).toHaveClass(/locked/);
  await expect(mappedSource).toHaveAttribute('aria-disabled', 'true');
  await mappedSource.click({ force: true });
  await expect(page.locator('.node.selected')).toHaveCount(0);

  const mappedTarget = page.locator('.node', { hasText: '01.11' }).first();
  await expect(mappedTarget).toHaveClass(/locked/);
  await mappedTarget.click({ force: true });
  await expect(page.locator('.node.selected')).toHaveCount(0);
  await expect(page.locator('.list header h3 .count')).toHaveText('1'); // still just the one group

  // An unmapped code on each side is unaffected and still selectable/linkable.
  await page.locator('.node', { hasText: '31111' }).first().click();
  await page.locator('.node', { hasText: '10.61' }).first().click();
  await expect(page.locator('.node.selected')).toHaveCount(2);
  await page.getByRole('button', { name: 'Group' }).click();
  await expect(page.locator('.list header h3 .count')).toHaveText('2');

  // Dragging an already-claimed code onto a *different* group is still skipped
  // (with a message), rather than silently reused.
  const secondRow = page.locator('.row').nth(1);
  await dragAndDrop(page.locator('.node', { hasText: '11111' }).first(), secondRow.locator('.pair > .side').first());
  await expect(page.locator('.list .flash')).toContainText('skipped');
  await expect(secondRow.locator('.pair > .side').first().locator('.bubble')).toHaveCount(1); // 31111 only, 11111 rejected

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('renaming a dataset is reflected in the exported crosswalk filename', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // treat it as "parent codes already included" rather than auto-generating
  // (which would otherwise wrap every real ancestor in a "<code> (group)" node).
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  // nace-sample.csv is likewise already fully populated with every ancestor level.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  // Rename both datasets: click each panel's edit button to reveal the name
  // field, edit it, then blur to commit (it collapses back to static text).
  const panelA = page.locator('.panel[data-accent="A"]');
  const panelB = page.locator('.panel[data-accent="B"]');
  await panelA.getByRole('button', { name: /^Rename/ }).click();
  await panelA.locator('.name-input').fill('My NAICS Set');
  await panelA.locator('.name-input').blur();
  await panelB.getByRole('button', { name: /^Rename/ }).click();
  await panelB.locator('.name-input').fill('My NACE Set');
  await panelB.locator('.name-input').blur();
  await expect(panelA.locator('.name-label')).toHaveText('My NAICS Set');
  await expect(panelB.locator('.name-label')).toHaveText('My NACE Set');

  // Create a mapping so export is enabled.
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();

  const download = await exportViaCiteModal(page);
  expect(download.suggestedFilename()).toMatch(/^my-naics-set-to-my-nace-set-crosswalk-.*\.csv$/);
});

test('mapping note stays compact static text until explicitly opened for editing', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // treat it as "parent codes already included" rather than auto-generating
  // (which would otherwise wrap every real ancestor in a "<code> (group)" node).
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  // nace-sample.csv is likewise already fully populated with every ancestor level.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();

  const row = page.locator('.row').first();

  // Names are not editable or displayed at all in the Mappings pane.
  await expect(row.getByRole('button', { name: /^Rename/ })).toHaveCount(0);
  await expect(row.locator('.name-label')).toHaveCount(0);

  // Note: a small toggle button, not a field taking up its own row, and no
  // "has-note" styling until a note actually exists.
  const noteBtn = row.locator('.note-btn');
  await expect(row.locator('.note-input')).toHaveCount(0);
  await expect(noteBtn).not.toHaveClass(/has-note/);

  await noteBtn.click();
  const noteInput = row.locator('.note-input');
  await expect(noteInput).toBeVisible();
  await noteInput.fill('reviewed by Jamie');
  await noteInput.blur();

  // Field collapses back to just the toggle button, which now reflects that a
  // note exists.
  await expect(noteInput).toHaveCount(0);
  await expect(noteBtn).toHaveClass(/has-note/);
  await expect(noteBtn).toHaveAttribute('title', 'reviewed by Jamie');

  // The note still made it into the group's data (verified via the export).
  const download = await exportViaCiteModal(page);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toMatch(/reviewed by Jamie/);
});

test('hovering a mapped code bubble shows a fast custom tooltip with its title', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // treat it as "parent codes already included" rather than auto-generating
  // (which would otherwise wrap every real ancestor in a "<code> (group)" node).
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  // nace-sample.csv is likewise already fully populated with every ancestor level.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();

  // No native `title` attribute on the bubble — the custom tooltip is the only
  // affordance, and it isn't shown until hovered.
  const bubble = page.locator('.row').first().locator('.bubble', { hasText: '11111' });
  await expect(bubble).not.toHaveAttribute('title');
  await expect(page.locator('.fast-tooltip')).toHaveCount(0);

  await bubble.hover();
  const tooltip = page.locator('.fast-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText('Soybean Farming');

  // Moving away hides it again.
  await bubble.dispatchEvent('mouseleave');
  await expect(tooltip).toHaveCount(0);
});

test('the fast tooltip stays within the viewport instead of overflowing past the edge', async ({ page }) => {
  await page.goto('./');

  const viewport = page.viewportSize();
  const tooltip = page.locator('.fast-tooltip');

  // Drive the shared tooltip store directly (via the dev-server's raw ES
  // module) rather than depending on a real element happening to sit at the
  // exact edge of the viewport — this reproduces "tooltip overflows the edge
  // of the page" deterministically regardless of layout.
  async function showAt(x, y, text = 'A fairly long tooltip explanation, long enough to risk overflowing an edge.') {
    await page.evaluate(
      async ([x, y, text]) => {
        const { tooltipState } = await import('./src/lib/tooltip.js');
        tooltipState.set({ text, x, y });
      },
      [x, y, text],
    );
  }

  // The store update and the resulting reposition-by-measurement land in
  // separate render passes, so poll rather than reading boundingBox() once
  // right after the evaluate() call resolves.
  async function expectClampedX() {
    await expect
      .poll(async () => {
        const box = await tooltip.boundingBox();
        return box.x >= 0 && box.x + box.width <= viewport.width;
      })
      .toBe(true);
  }

  // Pinned hard against the right edge.
  await showAt(viewport.width - 2, 200);
  await expect(tooltip).toBeVisible();
  await expectClampedX();

  // Pinned hard against the left edge.
  await showAt(2, 200);
  await expectClampedX();

  // Pinned near the top — must flip below its anchor instead of going
  // negative off the top of the page.
  await showAt(200, 2, 'Near the top');
  await expect.poll(async () => (await tooltip.boundingBox()).y).toBeGreaterThanOrEqual(0);
});

test('replacing a file deletes mappings that reference it, after confirmation', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // treat it as "parent codes already included" rather than auto-generating
  // (which would otherwise wrap every real ancestor in a "<code> (group)" node).
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  // nace-sample.csv is likewise already fully populated with every ancestor level.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();
  await expect(page.locator('.list header h3 .count')).toHaveText('1');

  const replaceBtn = page.locator('.panel[data-accent="A"]').getByRole('button', { name: /Replace file/ });
  await expect(replaceBtn).toHaveClass(/danger/);

  // Dismissing the confirmation leaves the mapping and the file intact.
  page.once('dialog', (d) => d.dismiss());
  await replaceBtn.click();
  await expect(page.locator('.list header h3 .count')).toHaveText('1');
  await expect(page.locator('.panel[data-accent="A"] .name-label')).toBeVisible();

  // Accepting it deletes the mapping (not just half of it) and returns to upload.
  page.once('dialog', (d) => {
    expect(d.message()).toContain('1 mapping');
    d.accept();
  });
  await replaceBtn.click();
  await expect(page.locator('.list header h3 .count')).toHaveText('0');
  await expect(page.locator('.setup[data-accent="A"] .label')).toHaveText('Upload System A CSV');
});

test('dragging a bubble in the Mappings pane onto another group moves it there', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // treat it as "parent codes already included" rather than auto-generating
  // (which would otherwise wrap every real ancestor in a "<code> (group)" node).
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  // nace-sample.csv is likewise already fully populated with every ancestor level.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // First group: 11111 -> 01.11, 01.41 (two B-side bubbles).
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.locator('.node', { hasText: '01.41' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();

  // Second group: 31111 -> 10.61.
  await page.locator('.node', { hasText: '31111' }).first().click();
  await page.locator('.node', { hasText: '10.61' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();

  await expect(page.locator('.row')).toHaveCount(2);
  const firstRow = page.locator('.row').nth(0);
  const secondRow = page.locator('.row').nth(1);
  await expect(firstRow.locator('.pair > .side').nth(1).locator('.bubble')).toHaveCount(2); // 01.11, 01.41
  await expect(secondRow.locator('.pair > .side').nth(1).locator('.bubble')).toHaveCount(1); // 10.61

  // Drag the 01.41 bubble from the first group's B side onto the second group's B side.
  await dragAndDrop(
    firstRow.locator('.bubble', { hasText: '01.41' }),
    secondRow.locator('.pair > .side').nth(1),
  );

  // Moved, not copied: gone from the source group, present on the target group.
  await expect(firstRow.locator('.pair > .side').nth(1).locator('.bubble')).toHaveCount(1);
  await expect(firstRow.locator('.bubble', { hasText: '01.41' })).toHaveCount(0);
  await expect(secondRow.locator('.pair > .side').nth(1).locator('.bubble')).toHaveCount(2);
  await expect(secondRow.locator('.bubble', { hasText: '01.41' })).toHaveCount(1);

  // Dropping a bubble back onto the row it already belongs to is a no-op, not a removal.
  await dragAndDrop(
    secondRow.locator('.bubble', { hasText: '01.41' }),
    secondRow.locator('.pair > .side').nth(1),
  );
  await expect(secondRow.locator('.pair > .side').nth(1).locator('.bubble')).toHaveCount(2);
});

test('per-node progress fraction badges, mapped-code tooltip/cursor, auto-collapse on completion, and collapsible search results', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // treat it as "parent codes already included" rather than auto-generating
  // (which would otherwise wrap every real ancestor in a "<code> (group)" node).
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  // nace-sample.csv is likewise already fully populated with every ancestor level.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  const panelA = page.locator('.panel[data-accent="A"]');
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // 1111 (Oilseed and Grain Farming) has exactly two leaf children: 11111, 11112.
  const node1111 = panelA.locator('.node', { hasText: /\b1111\b/ });
  const node11111 = panelA.locator('.node', { hasText: /\b11111\b/ });
  const node11112 = panelA.locator('.node', { hasText: /\b11112\b/ });

  // --- Nothing mapped yet: gray "0/2" fraction, not a raw count bubble. ---
  await expect(node1111.locator('.badge')).toHaveText('0/2');
  await expect(node1111.locator('.badge')).toHaveClass(/zero/);

  // --- Map just 11111; 1111 is now a blue (default) partial fraction, and the
  // mapped leaf itself shows a green checkmark instead of a numeric badge. ---
  await node11111.click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();
  await expect(node1111.locator('.badge')).toHaveText('1/2');
  await expect(node1111.locator('.badge')).not.toHaveClass(/zero|full/);
  await expect(node11111.locator('.badge')).toHaveText('✓');
  await expect(node11111.locator('.badge')).toHaveClass(/full/);

  // --- A partially-mapped parent is still clickable (its remaining unmapped
  // leaves via "select unmapped"), so it must not read as grayed-out/"done"
  // like a fully-mapped code does. ---
  await expect(node1111).not.toHaveClass(/mapped/);

  // --- A mapped code is always locked against a second mapping (no toggle to
  // enable this anymore), but still shows a plain description tooltip and a
  // normal cursor rather than an explanatory "why disabled" message or a
  // "blocked" cursor — the checkmark already communicates that. (This sample
  // has no separate description column, so the tooltip is simply absent
  // either way; what matters is it's never the old message.) ---
  await expect(node11111).toHaveClass(/locked/);
  const cursor = await node11111.evaluate((el) => getComputedStyle(el).cursor);
  expect(cursor).not.toBe('not-allowed');
  const title = (await node11111.getAttribute('title')) ?? '';
  expect(title).not.toContain('Already part of another mapping');

  // --- Completing 1111's last leaf turns its badge fully green *and*
  // auto-collapses the section (its children disappear from view) — but only
  // on that transition, so manually reopening it afterwards sticks. ---
  await node11112.click();
  await page.locator('.node', { hasText: '01.13' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();
  await expect(node1111.locator('.badge')).toHaveText('2/2');
  await expect(node1111.locator('.badge')).toHaveClass(/full/);
  // Now that every leaf underneath is mapped, the parent itself reads as
  // grayed-out/"done" too.
  await expect(node1111).toHaveClass(/mapped/);
  await expect(node11112).toHaveCount(0); // auto-collapsed, child rows gone

  await node1111.locator('.twist').click();
  await expect(node11112).toBeVisible(); // reopening it works and isn't fought

  // --- Searching reveals matches by auto-expanding their ancestors, but a
  // section shown only because it's part of the results can still be
  // collapsed (it used to be impossible to collapse anything while a search
  // filter was active). ---
  await page.locator('input[type=search]').first().fill('Cattle');
  const node112 = panelA.locator('.node', { hasText: /\b112\b/ });
  const node1121 = panelA.locator('.node', { hasText: /\b1121\b/ });
  const node11211 = panelA.locator('.node', { hasText: /\b11211\b/ });
  await expect(node112).toBeVisible();
  await expect(node1121).toBeVisible();
  await expect(node11211).toBeVisible();

  await node1121.locator('.twist').click();
  await expect(node11211).toHaveCount(0); // collapsed even though it's a search match
  await expect(node1121).toBeVisible(); // the collapsed node itself stays visible

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('search auto-expand retracts on clear instead of leaking into a permanently exploded tree', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  const panelA = page.locator('.panel[data-accent="A"]');
  const search = panelA.locator('input[type=search]');
  const before = await panelA.locator('.node').count();
  const deepLeaf = panelA.locator('.node', { hasText: /\b11111\b/ });

  // --- A broad single-character query (matches almost every numeric NAICS
  // code) legitimately auto-expands nearly the whole tree to reveal all its
  // matches... ---
  await search.fill('1');
  await expect(deepLeaf).toBeVisible();
  const during = await panelA.locator('.node').count();
  expect(during).toBeGreaterThan(before);

  // ...but clearing it must put all of that auto-expansion back. Previously
  // the auto-expand effect only ever added ancestors and never retracted
  // them, so a single broad keystroke like this left the tree permanently
  // exploded even after the search ended. ---
  await search.fill('');
  await expect(deepLeaf).toHaveCount(0);
  await expect(panelA.locator('.node')).toHaveCount(before);

  // --- A section the user explicitly collapses *during* a search is their
  // own choice and must stay collapsed once the search ends, even though the
  // search itself also needed it open to reveal a match. ---
  await search.fill('Cattle');
  const node1121 = panelA.locator('.node', { hasText: /\b1121\b/ });
  const node11211 = panelA.locator('.node', { hasText: /\b11211\b/ });
  await expect(node11211).toBeVisible();
  await node1121.locator('.twist').click();
  await expect(node11211).toHaveCount(0);
  await search.fill('');
  await expect(node11211).toHaveCount(0); // stays collapsed — the user owns it, clearing doesn't reopen it

  // --- A root that was already expanded by default (not by the search, not
  // by the user) must not be wrongly retracted just because it also
  // happened to be a needed ancestor while the search was active. ---
  const node111 = panelA.locator('.node', { hasText: /\b111\b/ });
  await expect(node111).toBeVisible();

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('the Collapse button actually collapses the top-level roots, and manually collapsing the last open root does not spring the others back open', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // naics-sample.csv has 3 roots (11, 31, 54); each is auto-expanded by
  // default, revealing its own depth-2 children while deeper levels stay
  // collapsed — 8 rows total right after building (3 roots + 5 children).
  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  const panelA = page.locator('.panel[data-accent="A"]');
  const root11 = panelA.locator('.node[data-code="11"]');
  const root31 = panelA.locator('.node[data-code="31"]');
  const root54 = panelA.locator('.node[data-code="54"]');
  await expect(root11).toBeVisible();
  await expect(root31).toBeVisible();
  await expect(root54).toBeVisible();
  await expect(panelA.locator('.node')).toHaveCount(8);

  // Regression: the "default expand roots" effect used to re-trigger any time
  // `expanded` became empty again (not just on first load), so clicking
  // "Collapse" — which empties it deliberately — silently re-expanded every
  // root right back out, making the button look broken at the top level.
  await panelA.locator('button', { hasText: 'Collapse' }).click();
  await expect(panelA.locator('.node')).toHaveCount(3); // only the 3 roots remain, none re-expanded

  // Re-expand, then manually collapse each root one at a time via its own
  // twist arrow (not the "Collapse" button) — collapsing the very last open
  // root must not re-expand the ones already closed.
  await panelA.locator('button', { hasText: 'Expand' }).click();
  await root11.locator('.twist').click();
  await root31.locator('.twist').click();
  await expect(panelA.locator('.node[data-code="541"]')).toBeVisible(); // 54's child still visible — not yet touched
  await root54.locator('.twist').click(); // collapse the last remaining open root
  await expect(panelA.locator('.node[data-code="541"]')).toHaveCount(0); // 54 itself is now collapsed
  await expect(panelA.locator('.node[data-code="111"]')).toHaveCount(0); // 11's child must stay hidden, not spring back open
  await expect(panelA.locator('.node[data-code="311"]')).toHaveCount(0); // 31's child must stay hidden, not spring back open
  await expect(panelA.locator('.node')).toHaveCount(3); // still just the 3 (collapsed) roots

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('clicking a code bubble in the Mappings pane reveals and flashes it in its tree panel', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  const panelA = page.locator('.panel[data-accent="A"]');
  const panelB = page.locator('.panel[data-accent="B"]');
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // Map only one of 1111's two leaf children (11111) so the group's bubble
  // can't compact past the raw leaf — 1111 (Oilseed and Grain Farming) has
  // two leaves, 11111 and 11112, so leaving 11112 unselected guarantees a
  // real depth-4 code to test with, rather than one already compacted up to
  // a shallower, always-visible ancestor.
  await panelA.locator('.node', { hasText: /\b11111\b/ }).click();
  await panelB.locator('.node', { hasText: /\b01\.11\b/ }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();

  // Collapse everything, confirming the mapped leaf is genuinely hidden.
  await panelA.locator('button', { hasText: 'Collapse' }).click();
  const target = panelA.locator('.node', { hasText: /\b11111\b/ });
  await expect(target).toHaveCount(0);

  // Clicking its bubble in the Mappings pane must expand its ancestors,
  // scroll it into view, and flash-highlight it.
  await page.locator('.row .bubble', { hasText: '11111' }).first().click();
  await expect(target).toBeVisible();
  await expect(target).toHaveClass(/flash/);
  await expect(target).not.toHaveClass(/flash/, { timeout: 3000 }); // the flash fades on its own

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('hovering a mapped code scrolls its Mappings-pane row into view', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // A short viewport so ten single-code mapping rows genuinely overflow the
  // Mappings pane and the first row can be scrolled out of view.
  await page.setViewportSize({ width: 1400, height: 500 });

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  const panelA = page.locator('.panel[data-accent="A"]');
  const panelB = page.locator('.panel[data-accent="B"]');
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // Map every leaf on side A to a distinct leaf on side B, one pair per
  // click, so each becomes its own mapping row (ten rows total).
  const codesA = await panelA
    .locator('.node:has(.twist.spacer)')
    .evaluateAll((els) => els.map((e) => e.dataset.code));
  const codesB = await panelB
    .locator('.node:has(.twist.spacer)')
    .evaluateAll((els) => els.map((e) => e.dataset.code));
  for (let i = 0; i < Math.min(codesA.length, codesB.length); i++) {
    await panelA.locator(`.node[data-code="${codesA[i]}"]`).click();
    await panelB.locator(`.node[data-code="${codesB[i]}"]`).click();
    await page.getByRole('button', { name: 'Group' }).click();
  }
  await expect(page.locator('.row')).toHaveCount(10);

  const rows = page.locator('.rows');
  await expect(async () => {
    expect(await rows.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  }).toPass();

  // Scroll the mapping list all the way to the bottom, so the very first
  // row (the mapping for codesA[0], created first) is off-screen.
  await rows.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const firstRow = page.locator('.row').first();
  await expect(firstRow).not.toBeInViewport();

  // Hovering the root code (which touches every leaf beneath it, including
  // codesA[0]) must highlight *and* scroll the first row back into view —
  // previously only the highlight happened, leaving the row off-screen.
  await panelA.locator('.node[data-code="11"]').hover();
  await expect(firstRow).toBeInViewport();

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('long titles wrap instead of being cut off, and the progress bar turns green at 100%', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  // naics-sample.csv already has an explicit row for every ancestor level, so
  // treat it as "parent codes already included" rather than auto-generating
  // (which would otherwise wrap every real ancestor in a "<code> (group)" node).
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  // nace-sample.csv is likewise already fully populated with every ancestor level.
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  const panelA = page.locator('.panel[data-accent="A"]');
  for (const b of await panelA.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // --- A long title wraps onto further lines (taller row) instead of being
  // ellipsized onto one line, unlike a short-title row. ---
  const longRow = panelA.locator('.node', { hasText: 'Accounting, Tax Preparation, Bookkeeping, and Payroll Services' }).first();
  const shortRow = panelA.locator('.node', { hasText: /\b112\b/ });
  await expect(longRow.locator('.desc')).toHaveCSS('white-space', 'normal');
  const longBox = await longRow.boundingBox();
  const shortBox = await shortRow.boundingBox();
  expect(longBox.height).toBeGreaterThan(shortBox.height * 1.5);

  // --- Progress bar turns green once a panel reaches 100%. A separate tiny
  // single-leaf-per-side upload keeps this cheap (no need to map all 10
  // leaves of the shared sample). No mappings exist yet, so "Replace file…"
  // swaps the file without a confirmation prompt.
  const tinyA = 'level,code,description\n1,X1,Only code\n';
  const tinyB = 'level,code,description\n1,Y1,Only code\n';
  await page.locator('.panel[data-accent="A"]').getByRole('button', { name: /Replace file/ }).click();
  await csvInput.first().setInputFiles({ name: 'tiny-a.csv', mimeType: 'text/csv', buffer: Buffer.from(tinyA) });
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await page.locator('.panel[data-accent="B"]').getByRole('button', { name: /Replace file/ }).click();
  await csvInput.first().setInputFiles({ name: 'tiny-b.csv', mimeType: 'text/csv', buffer: Buffer.from(tinyB) });
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  await expect(page.locator('.progress-fill').first()).not.toHaveClass(/complete/);
  await page.locator('.node', { hasText: 'X1' }).first().click();
  await page.locator('.node', { hasText: 'Y1' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();
  await expect(page.locator('.progress-label').nth(0)).toHaveText('1 / 1 mapped');
  await expect(page.locator('.progress-fill').first()).toHaveClass(/complete/);
  await expect(page.locator('.progress-fill').nth(1)).toHaveClass(/complete/);

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('marking several codes no-match at once creates a distinct row per code, not one shared group', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // 11121 and 11211 sit in unrelated branches — selecting both and marking
  // them no-match together must not bundle them into a single multi-code row.
  await page.locator('.node', { hasText: '11121' }).first().click();
  await page.locator('.node', { hasText: '11211' }).first().click();
  await page.getByRole('button', { name: /Mark 2 as no match/ }).click();

  await expect(page.locator('.row')).toHaveCount(2);
  const row11121 = page.locator('.row', { hasText: '11121' });
  const row11211 = page.locator('.row', { hasText: '11211' });
  await expect(row11121).toBeVisible();
  await expect(row11211).toBeVisible();
  // Each row holds only its own single code, not both.
  await expect(row11121.locator('.bubble')).toHaveCount(1);
  await expect(row11211.locator('.bubble')).toHaveCount(1);
});

test('flagging every leaf under a shared ancestor as no-match together collapses to one row, not one per leaf', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // 1111 has exactly two leaf children, 11111 and 11112 (see the "select
  // unmapped" test above for this sample's shape). Nothing is mapped yet, so
  // clicking the ancestor selects both of them; marking them no-match
  // together must produce one row for "1111" (TODO.md: e.g. code 07 with
  // leaves 07.1/07.21/07.29 should be one entry, not three), not two rows.
  await page.locator('.node', { hasText: /\b1111\b/ }).first().click();
  await expect(page.locator('.node.selected')).toHaveCount(1);
  await page.getByRole('button', { name: /Mark 1 as no match/ }).click();

  await expect(page.locator('.row')).toHaveCount(1);
  await expect(page.locator('.row .bubble-code')).toHaveText('1111');

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('two separately fully-covered ancestors flagged no-match together still produce two rows, not one merged parent row', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // 1111 (leaves 11111/11112) and 112 (sole leaf 11211) are disjoint branches
  // under the shared ancestor 11 — but 11's third branch (1112's leaf 11121)
  // is left unflagged, so 11 itself is *not* fully covered. Flagging both
  // fully-covered branches in one action must still create two separate
  // rows, not one row merged all the way up to "11".
  await page.locator('.node', { hasText: /\b1111\b/ }).first().click();
  await page.locator('.node', { hasText: /\b112\b/ }).first().click();
  await expect(page.locator('.node.selected')).toHaveCount(2);
  await page.getByRole('button', { name: /Mark 2 as no match/ }).click();

  await expect(page.locator('.row')).toHaveCount(2);
  const bubbleCodes = (await page.locator('.row .bubble-code').allTextContents()).sort();
  expect(bubbleCodes).toEqual(['1111', '112']);

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('the mapping relationship toggle switches between equal and approximately-equal, and it\'s exported', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();

  // An equals sign, not the old two-way arrow — pairs visually with "≈".
  const relBtn = page.locator('.row').first().locator('.rel');
  await expect(relBtn).toHaveText('=');

  await relBtn.click();
  await expect(relBtn).toHaveText('≈');

  const download = await exportViaCiteModal(page);
  const csv = readFileSync(await download.path(), 'utf8');
  const parsed = Papa.parse(csv, { header: true }).data;
  const exportedRow = parsed.find((r) => r.code === '11111'); // the only group in this test
  expect(exportedRow.relationship).toBe('approximate');

  // Toggling back flips it to "equal" again.
  await relBtn.click();
  await expect(relBtn).toHaveText('=');
});

test('the mapping bar\'s equal/approx switch sets the relationship a new mapping is created with', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // "=" is selected by default.
  const eqOpt = page.locator('.relswitch-opt', { hasText: '=' });
  const approxOpt = page.locator('.relswitch-opt', { hasText: '≈' });
  await expect(eqOpt).toHaveClass(/active/);
  await expect(approxOpt).not.toHaveClass(/active/);

  await approxOpt.click();
  await expect(approxOpt).toHaveClass(/active/);
  await expect(eqOpt).not.toHaveClass(/active/);

  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();

  // The created mapping picked up "approximate" straight away, with no
  // separate toggle click needed afterward.
  const relBtn = page.locator('.row').first().locator('.rel');
  await expect(relBtn).toHaveText('≈');
});

test('pressing G triggers Group, but not while typing in the search box or a note field', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // Typing "g" into the search box must not fire Group — it's just a search
  // letter — and must not even be possible since Group is disabled anyway
  // (nothing selected yet).
  const searchBox = page.locator('input[type=search]').first();
  await searchBox.fill('g');
  await expect(page.locator('.row')).toHaveCount(0);
  await searchBox.fill('');

  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();

  // Typing "g" into the mapping note field must not fire Group either.
  const noteInput = page.getByPlaceholder('Optional note…');
  await noteInput.fill('g');
  await expect(page.locator('.row')).toHaveCount(0);
  await noteInput.fill('');

  // With both sides selected and focus outside any input, pressing "G"
  // triggers Group exactly like clicking the button.
  await noteInput.evaluate((el) => el.blur());
  await page.keyboard.press('g');
  await expect(page.locator('.row')).toHaveCount(1);
});

test('undo/redo buttons in the toolbar step through mapping changes', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  const undoBtn = page.getByRole('button', { name: 'Undo last mapping change' });
  const redoBtn = page.getByRole('button', { name: 'Redo last undone mapping change' });
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeDisabled();

  // Create a mapping — undo becomes available, redo still isn't.
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(undoBtn).toBeEnabled();
  await expect(redoBtn).toBeDisabled();

  // Undo removes it again, and now redo is available instead.
  await undoBtn.click();
  await expect(page.locator('.row')).toHaveCount(0);
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeEnabled();

  // Redo brings it back.
  await redoBtn.click();
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(undoBtn).toBeEnabled();
  await expect(redoBtn).toBeDisabled();

  // A fresh edit after an undo clears whatever could have been redone.
  await undoBtn.click();
  await expect(page.locator('.row')).toHaveCount(0);
  await page.locator('.node', { hasText: '54151' }).first().click();
  await page.getByRole('button', { name: /Mark 1 as no match/ }).click();
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(redoBtn).toBeDisabled();
});

test('the help overlay opens from the toolbar and can be closed via the X button, Escape, or the backdrop', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const helpBtn = page.getByRole('button', { name: 'Help' });
  const modal = page.locator('.help-modal');

  await helpBtn.click();
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('crosswalk', { ignoreCase: true });
  await expect(modal).toContainText('Keyboard shortcuts', { ignoreCase: true });

  await page.getByRole('button', { name: 'Close help' }).click();
  await expect(modal).toHaveCount(0);

  await helpBtn.click();
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await helpBtn.click();
  await expect(modal).toBeVisible();
  await page.locator('.help-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(modal).toHaveCount(0);
});

test('exporting requires agreeing to a citation prompt before the download happens', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByLabel('Data includes parent codes').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Group' }).click();

  const exportBtn = page.getByRole('button', { name: 'Export crosswalk (.csv)' });
  const modal = page.locator('.help-modal', { hasText: 'Export crosswalk' });
  const agree = page.getByLabel('I agree to credit Crosswalk Generator when using this data.');
  const confirmBtn = modal.getByRole('button', { name: 'Export' });

  // Clicking the toolbar button only opens the prompt — it never downloads by itself.
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await exportBtn.click();
  await expect(modal).toBeVisible();
  await expect(confirmBtn).toBeDisabled(); // must agree first
  expect(downloads).toHaveLength(0);

  // Canceling closes it without downloading anything either.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(modal).toHaveCount(0);
  expect(downloads).toHaveLength(0);

  // Agreeing enables the modal's own Export button, which then actually downloads.
  await exportBtn.click();
  await agree.check();
  await expect(confirmBtn).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), confirmBtn.click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  await expect(modal).toHaveCount(0);
});

test('the G shortcut does not fire while the help overlay is open', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();

  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.locator('.help-modal')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.locator('.row')).toHaveCount(0);
});
