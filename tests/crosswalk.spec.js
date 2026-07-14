import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

test('build hierarchies, map codes as groups, persist, and export a crosswalk', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.getByText('Crosswalk Generator')).toBeVisible();

  // --- Upload both systems. Each panel's file input unmounts once its tree is
  // built, so take the first remaining CSV input for each upload. ---
  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await expect(csvInput).toHaveCount(2);

  await csvInput.first().setInputFiles(A);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await expect(page.getByText('26 codes')).toBeVisible(); // NAICS

  await csvInput.first().setInputFiles(B);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await expect(page.getByText('25 codes')).toBeVisible(); // NACE

  // --- Progress bars start at 0 of the 10 leaf codes in each sample system. ---
  await expect(page.locator('.progress-label').nth(0)).toHaveText('0 / 10 mapped');
  await expect(page.locator('.progress-label').nth(1)).toHaveText('0 / 10 mapped');

  // Correct nesting: expand-all and confirm a deep code is visible.
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();
  await expect(page.locator('.node', { hasText: '01.11' }).first()).toBeVisible();

  // --- No relation/match-type dropdown anywhere in the mapping bar. ---
  await expect(page.locator('select[aria-label="Relationship type"]')).toHaveCount(0);

  // --- Many-to-many creates ONE group row, not N rows. ---
  // (01.11 and 01.41 sit under different immediate parents, so neither fully
  // covers a parent's leaves — no display-compaction merges them into one bubble.)
  await page.locator('.node', { hasText: '11111' }).first().click(); // Soybean Farming (source, leaf)
  await page.locator('.node', { hasText: '01.11' }).first().click(); // target 1
  await page.locator('.node', { hasText: '01.41' }).first().click(); // target 2
  const link = page.getByRole('button', { name: /Link 1 × 2/ });
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

  // --- "Select unmapped" selects only not-yet-mapped leaves under a parent. ---
  await page.locator('.node', { hasText: '1111' }).first().hover();
  await page.locator('.node', { hasText: '1111' }).first().locator('.select-unmapped').click();
  // 1111's leaves are 11111 (already mapped, skipped) and 11112 (unmapped, selected).
  await expect(page.locator('.node.selected')).toHaveCount(1);
  await expect(page.locator('.node.selected', { hasText: '11112' })).toBeVisible();
  await page.locator('.panel[data-accent="A"] .selcount .linky').click();
  await expect(page.locator('.node.selected')).toHaveCount(0);

  // --- Rename the group inline. ---
  const nameInput = row.locator('.name-input');
  await nameInput.fill('Soybean crosswalk');
  await nameInput.blur();
  await expect(row.locator('.name-input')).toHaveValue('Soybean crosswalk');

  // --- Remove a single code (bubble) from the group without deleting the row. ---
  await row.locator('.bubble', { hasText: '01.41' }).locator('.bubble-x').click();
  await expect(row.locator('.pair > .side').nth(1).locator('.bubble')).toHaveCount(1);
  await expect(page.locator('.row')).toHaveCount(1); // group still exists (target side not empty)

  // --- Drag a code from the tree onto the existing group to add it. ---
  await dragAndDrop(page.locator('.node', { hasText: '31111' }).first(), row.locator('.pair > .side').first());
  await expect(row.locator('.pair > .side').first().locator('.bubble')).toHaveCount(2); // 11111, 31111

  // --- Hovering a mapped code in a tree panel highlights its group in the Mappings pane. ---
  await expect(row).not.toHaveClass(/highlighted/);
  await page.locator('.node', { hasText: '11111' }).first().hover();
  await expect(row).toHaveClass(/highlighted/);
  await page.locator('.node', { hasText: '11111' }).first().dispatchEvent('mouseleave');
  await expect(row).not.toHaveClass(/highlighted/);

  // --- No match (source side only) creates its own group/row. ---
  await page.locator('.node', { hasText: '54151' }).first().click();
  const noMatchBtn = page.getByRole('button', { name: /Mark 1 as no match/ });
  await expect(noMatchBtn).toBeVisible();
  await noMatchBtn.click();
  // 5415 is 54151's sole parent (they share a description in this sample), so the
  // Mappings pane displays the compacted parent code "5415", not the leaf "54151" —
  // per the parent-code-for-brevity rule. The tree itself still shows the real leaf.
  await expect(page.locator('.row.nomatch', { hasText: '5415' })).toBeVisible();
  await expect(page.locator('.node', { hasText: '54151' }).locator('.badge.nomatch')).toBeVisible();
  await expect(page.locator('.row')).toHaveCount(2);

  // --- Persistence across reload. ---
  await page.reload();
  await expect(page.locator('.list header h3 .count')).toHaveText('2');
  await expect(page.locator('.row').first().locator('.name-input')).toHaveValue('Soybean crosswalk');

  // --- Export mode A: one CSV, N×N cross-product. ---
  const [downloadSingle] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const csvSingle = readFileSync(await downloadSingle.path(), 'utf8');
  expect(csvSingle.split(/\r?\n/)[0]).toBe(
    'source_code,source_title,target_code,target_title,group_name,note',
  );
  expect(csvSingle).toMatch(/11111,Soybean Farming,01\.11/);
  // No-match row: blank target.
  expect(csvSingle).toMatch(/54151,[^\n]*,,,/);

  // --- Export mode B: two files (source->name, name->target). ---
  await page.selectOption('select[aria-label="Export format"]', 'split');
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect.poll(() => downloads.length).toBe(2);
  const names = downloads.map((d) => d.suggestedFilename());
  expect(names.some((n) => n.includes('source-to-name'))).toBe(true);
  expect(names.some((n) => n.includes('name-to-target'))).toBe(true);
  const [downloadSrc, downloadTgt] = names[0].includes('source-to-name') ? downloads : [downloads[1], downloads[0]];
  const srcCsv = readFileSync(await downloadSrc.path(), 'utf8');
  const tgtCsv = readFileSync(await downloadTgt.path(), 'utf8');
  const sourceToNameCsv = srcCsv.startsWith('source_code') ? srcCsv : tgtCsv;
  const nameToTargetCsv = srcCsv.startsWith('source_code') ? tgtCsv : srcCsv;
  expect(sourceToNameCsv.split(/\r?\n/)[0]).toBe('source_code,source_title,group_name');
  expect(nameToTargetCsv.split(/\r?\n/)[0]).toBe('group_name,target_code,target_title');
  expect(sourceToNameCsv).toMatch(/11111,Soybean Farming,Soybean crosswalk/);
  expect(nameToTargetCsv).toMatch(/Soybean crosswalk,01\.11/);

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('sample dataset shortcut loads a system without an uploaded file', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole('button', { name: 'Try with sample data' }).first().click();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await expect(page.getByText('26 codes')).toBeVisible(); // NAICS sample
});

test('auto-detect level builds a hierarchy without picking a level column', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByLabel('Auto-detect level from code').check();
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await expect(page.getByText('26 codes')).toBeVisible(); // NAICS: still all 26 rows kept

  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();
  // Auto-detected (length-based) levels reproduce the same nesting as the explicit level column.
  await expect(page.locator('.node', { hasText: '11111' }).first()).toBeVisible();

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('unique-mapping-once toggle blocks reusing a code across two groups', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // First group: 11111 <-> 01.11. Untouched by the toggle (still off).
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: /Link 1 × 1/ }).click();
  await expect(page.locator('.list header h3 .count')).toHaveText('1');

  // Turn the restriction on, then try to reuse both of the same codes in a new group.
  await page.getByLabel('Only allow each code to be mapped once').check();
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: /Link 1 × 1/ }).click();

  await expect(page.locator('.bar .hint .ok')).toContainText('skipped');
  await expect(page.locator('.list header h3 .count')).toHaveText('1'); // no new/partial group created

  // With the toggle off again, the same codes can be added to a fresh group.
  await page.getByLabel('Only allow each code to be mapped once').uncheck();
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '10.61' }).first().click();
  await page.getByRole('button', { name: /Link 1 × 1/ }).click();
  await expect(page.locator('.list header h3 .count')).toHaveText('2');

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});
