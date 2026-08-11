/**
 * Builds the store archive.
 *
 * Timestamps are pinned and entries are sorted, so two builds of the same commit produce the same
 * bytes and anyone can check the published archive against the source. The file list is an
 * allow-list: tests and tools must never end up inside a shipped extension.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_ENDPOINT } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = ['manifest.json', '_locales', 'icons', 'src'];
const STAGE = join(ROOT, 'build', 'stage');
const OUT = join(ROOT, 'build');

const version = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;
const zipPath = join(OUT, `trickybird-extension-${version}.zip`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const entry of SHIPPED) cpSync(join(ROOT, entry), join(STAGE, entry), { recursive: true });

/** @param {string} dir @returns {string[]} */
const walk = (dir) => readdirSync(dir).flatMap((/** @type {string} */ name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
// The local console is named in the source manifest so the extension can be loaded straight from
// the repository and pointed at a stack on the developer's own machine. It has no business in a
// published archive: an origin allowed to move the rule table is worth removing even when nobody
// can reach it.
const staged = join(STAGE, 'manifest.json');
const manifest = JSON.parse(readFileSync(staged, 'utf8'));
const shipped = manifest.externally_connectable.matches
  .filter((/** @type {string} */ m) => !m.startsWith(`${DEV_ENDPOINT}/`));
if (shipped.length === 0) throw new Error('every console origin was stripped from the manifest');
manifest.externally_connectable.matches = shipped;
writeFileSync(staged, `${JSON.stringify(manifest, null, 2)}\n`);
// Read back rather than trusted: the filter above only knows about one field, and this is the last
// point at which the developer's own console can be caught before the archive is signed.
if (readFileSync(staged, 'utf8').includes(DEV_ENDPOINT)) {
  throw new Error(`${DEV_ENDPOINT} is still named in the manifest being packaged`);
}

const files = walk(STAGE).sort();

// Fixed mtime and fixed timezone together; either alone still yields different archives on
// machines an hour apart.
execFileSync('touch', ['-t', '198001010000', ...files]);
execFileSync('zip', ['-qXr', zipPath, ...files.map((/** @type {string} */ f) => relative(STAGE, f))], {
  cwd: STAGE,
  env: { ...process.env, TZ: 'UTC' },
});

const sha = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
rmSync(STAGE, { recursive: true, force: true });
console.log(`${relative(ROOT, zipPath)}\nsha256 ${sha}\n${files.length} files`);
console.log(`console origins: ${shipped.join(', ')}`);
