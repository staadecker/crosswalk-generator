/**
 * Confirms `vite build` (what `npm run build` and CI both run) produces no
 * warnings on stderr — e.g. Svelte compiler a11y warnings or unused-CSS-selector
 * warnings, which `vite build`/`vite dev` print but do not fail the process for.
 *   npm run test:build
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(cond, msg) {
  console.log((cond ? '✓ ' : '❌ FAIL: ') + msg);
  if (!cond) failures++;
}

// Build into a throwaway dir nested under the already-gitignored `dist/`, so
// this never clobbers a real `npm run build` output.
const outDir = 'dist/.test-build';
const result = spawnSync('npx', ['vite', 'build', '--outDir', outDir], {
  cwd: root,
  encoding: 'utf8',
});

check(result.status === 0, 'vite build exits successfully');

const stderr = (result.stderr ?? '').trim();
if (stderr) console.log('--- stderr ---\n' + stderr + '\n--------------');
check(stderr === '', 'vite build prints no warnings on stderr');

rmSync(resolve(root, outDir), { recursive: true, force: true });

console.log(failures === 0 ? '\nAll vite-build checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
