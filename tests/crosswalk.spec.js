import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const A = 'samples/naics-sample.csv';
const B = 'samples/nace-sample.csv';

test('build hierarchies, map codes, persist, and export a crosswalk', async ({ page }) => {
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

  // Correct nesting: expand-all and confirm a deep code is visible.
  for (const b of await page.locator('.controls button', { hasText: 'Expand' }).all()) await b.click();
  await expect(page.locator('.node', { hasText: '01.11' }).first()).toBeVisible();

  // --- Create two mappings with different relations. ---
  const link = page.getByRole('button', { name: 'Link', exact: true });

  await page.locator('.node', { hasText: '11111' }).first().click(); // Soybean Farming
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await page.selectOption('select[aria-label="Relationship type"]', 'exact');
  await expect(link).toBeEnabled();
  await link.click();

  await page.locator('.node', { hasText: '111' }).first().click(); // Crop Production
  await page.locator('.node', { hasText: '01.1' }).first().click();
  await page.selectOption('select[aria-label="Relationship type"]', 'broader');
  await link.click();

  await expect(page.locator('.list header h3 .count')).toHaveText('2');
  await expect(page.locator('.list .row', { hasText: 'Soybean Farming' })).toBeVisible();
  await expect(page.locator('.node', { hasText: '11111' }).locator('.badge').first()).toBeVisible();

  // --- Duplicate guard. ---
  await page.locator('.node', { hasText: '11111' }).first().click();
  await page.locator('.node', { hasText: '01.11' }).first().click();
  await expect(link).toBeDisabled();

  // --- Persistence across reload. ---
  await page.reload();
  await expect(page.locator('.list header h3 .count')).toHaveText('2');

  // --- Export CSV. ---
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv.split(/\r?\n/)[0]).toBe(
    'source_code,source_description,target_code,target_description,relation,relation_label,note',
  );
  expect(csv).toMatch(/11111,Soybean Farming,01\.11/);

  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
});
