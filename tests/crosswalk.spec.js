import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const A = 'samples/naics-sample.csv';
const B = 'samples/nace-sample.csv';

/** Read the named text entries out of a STORE-method (uncompressed) zip file —
 * exactly what src/lib/zip.js produces — without needing a zip library. */
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
  const link = page.getByRole('button', { name: 'Link' });
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

  // --- Rename the group: the name is static text until the edit button opens it
  // for editing (kept out of always-editable inputs so dense rows stay compact). ---
  await row.getByRole('button', { name: /^Rename/ }).click();
  const nameInput = row.locator('.name-input');
  await nameInput.fill('Soybean crosswalk');
  await nameInput.blur();
  await expect(row.locator('.name-label')).toHaveText('Soybean crosswalk');

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
  // per the parent-code-for-brevity rule. The tree itself still shows the real leaf.
  await expect(page.locator('.row.nomatch', { hasText: '5415' })).toBeVisible();
  await expect(page.locator('.node', { hasText: '54151' }).locator('.badge.nomatch')).toBeVisible();
  await expect(page.locator('.row')).toHaveCount(2);

  // --- Persistence across reload. ---
  await page.reload();
  await expect(page.locator('.list header h3 .count')).toHaveText('2');
  await expect(page.locator('.row').first().locator('.name-label')).toHaveText('Soybean crosswalk');

  // --- Export: one .zip download containing all three crosswalk files. ---
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export crosswalk (.zip)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const entries = readZipEntries(readFileSync(await download.path()));
  expect(Object.keys(entries).sort()).toEqual(['a-to-name.csv', 'crosswalk.csv', 'name-to-b.csv']);

  const csvSingle = entries['crosswalk.csv'];
  expect(csvSingle.split(/\r?\n/)[0]).toBe(
    'a_code,a_title,b_code,b_title,group_name,note',
  );
  expect(csvSingle).toMatch(/11111,Soybean Farming,01\.11/);
  // No-match row: blank B side.
  expect(csvSingle).toMatch(/54151,[^\n]*,,,/);

  const aToNameCsv = entries['a-to-name.csv'];
  const nameToBCsv = entries['name-to-b.csv'];
  expect(aToNameCsv.split(/\r?\n/)[0]).toBe('a_code,a_title,group_name');
  expect(nameToBCsv.split(/\r?\n/)[0]).toBe('group_name,b_code,b_title');
  expect(aToNameCsv).toMatch(/11111,Soybean Farming,Soybean crosswalk/);
  expect(nameToBCsv).toMatch(/Soybean crosswalk,01\.11/);

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('sample dataset shortcut builds a hierarchy in one click, no column mapping shown', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Several sample datasets are offered per side; picking one skips column
  // mapping entirely — no "Build hierarchy" step to click through.
  const sampleButtons = page.locator('.sample-btn');
  await expect(sampleButtons).toHaveCount(6); // 3 datasets x 2 panels
  await expect(page.getByRole('button', { name: 'Build hierarchy' })).toHaveCount(0);

  await page.getByRole('button', { name: 'NAICS (small sample)' }).first().click();
  await expect(page.getByRole('button', { name: 'Build hierarchy' })).toHaveCount(0);
  await expect(page.getByText('26 codes')).toBeVisible(); // NAICS sample
});

test('the full NAICS 2022 sample auto-nests without dumping subsectors under a stray parent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole('button', { name: 'NAICS 2022 (full, with descriptions)' }).first().click();
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
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();

  const panelA = page.locator('.panel[data-accent="A"]');
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // Map just 11111 (one of 11's four leaves), leaving the rest of sector 11 unmapped.
  await panelA.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.getByRole('button', { name: 'Link' }).click();

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

  // Click "select unmapped" on the (collapsed, not-yet-expanded) root sector 11.
  const root11 = panelA.locator('.node', { hasText: /\b11\b/ });
  await root11.hover();
  await root11.locator('.select-unmapped').click();

  // The previously-hidden branch must now be visible (auto-expanded)...
  await expect(node1112).toBeVisible();
  await expect(node112).toBeVisible();
  // ...and the selection is compacted to the topmost fully-unmapped code at each
  // branch (11112, 1112, 112) rather than a pile of raw leaf codes.
  await expect(panelA.locator('.node.selected')).toHaveCount(3);
  await expect(node11112).toHaveClass(/selected/);
  await expect(node1112).toHaveClass(/selected/);
  await expect(node112).toHaveClass(/selected/);
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

test('unique-mapping-once toggle blocks selecting an already-mapped code outright', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.locator('.list header h3 .count')).toHaveText('1');

  // Turn the restriction on: clicking an already-mapped code must not select it at
  // all (not silently drop it later at Link time) — the click is refused outright.
  // The node is marked aria-disabled, so Playwright's normal actionability check
  // would itself refuse to click it; force the click to prove the app's own click
  // handler (not just the browser) rejects it.
  await page.getByLabel('Only allow each code to be mapped once').check();
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
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.locator('.list header h3 .count')).toHaveText('2');

  // Dragging an already-claimed code onto a *different* group is still skipped
  // (with a message), rather than silently reused.
  const secondRow = page.locator('.row').nth(1);
  await dragAndDrop(page.locator('.node', { hasText: '11111' }).first(), secondRow.locator('.pair > .side').first());
  await expect(page.locator('.list .flash')).toContainText('skipped');
  await expect(secondRow.locator('.pair > .side').first().locator('.bubble')).toHaveCount(1); // 31111 only, 11111 rejected

  // With the toggle off again, an already-used code can be reused freely.
  await page.getByLabel('Only allow each code to be mapped once').uncheck();
  await expect(page.locator('.node', { hasText: '11111' }).first()).not.toHaveClass(/locked/);
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '10.91' }).first().click();
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.locator('.list header h3 .count')).toHaveText('3');

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});

test('renaming a dataset is reflected in the exported crosswalk filename', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
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
  await page.getByRole('button', { name: 'Link' }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export crosswalk (.zip)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^my-naics-set-to-my-nace-set-crosswalk-.*\.zip$/);
});

test('mapping name and note stay compact static text until explicitly opened for editing', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Link' }).click();

  const row = page.locator('.row').first();

  // Name: static label + edit button by default, no bare input in the row.
  await expect(row.locator('.name-label')).toBeVisible();
  await expect(row.locator('.name-input')).toHaveCount(0);

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

  // The note still made it into the group's data (verified via the zip export).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export crosswalk (.zip)' }).click(),
  ]);
  const entries = readZipEntries(readFileSync(await download.path()));
  expect(entries['crosswalk.csv']).toMatch(/reviewed by Jamie/);
});

test('hovering a mapped code bubble shows a fast custom tooltip with its title', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Link' }).click();

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

test('replacing a file deletes mappings that reference it, after confirmation', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Link' }).click();
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
  await expect(page.getByRole('button', { name: 'NAICS (small sample)' })).toBeVisible();
});

test('dragging a bubble in the Mappings pane onto another group moves it there', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const csvInput = page.locator('input[type=file][accept*="csv"]');
  await csvInput.first().setInputFiles(A);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  await csvInput.first().setInputFiles(B);
  await page.getByRole('button', { name: 'Build hierarchy' }).click();
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();

  // First group: 11111 -> 01.11, 01.41 (two B-side bubbles).
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.locator('.node', { hasText: '01.41' }).first().click();
  await page.getByRole('button', { name: 'Link' }).click();

  // Second group: 31111 -> 10.61.
  await page.locator('.node', { hasText: '31111' }).first().click();
  await page.locator('.node', { hasText: '10.61' }).first().click();
  await page.getByRole('button', { name: 'Link' }).click();

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
