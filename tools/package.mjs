/**
 * Builds the store archive.
 *
 * Timestamps are pinned and entries are sorted, so two builds of the same commit produce the same
 * bytes and anyone can check the published archive against the source. The file list is an
 * allow-list: tests and tools must never end up inside a shipped extension.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
