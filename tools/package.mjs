/**
 * Builds the store archive.
 *
 * Timestamps are pinned and entries are sorted, so two builds of the same commit produce the same
 * bytes and anyone can check the published archive against the source. The file list is an
 * allow-list: tests and tools must never end up inside a shipped extension.
 *
 * `--target chrome|edge` picks which store the archive is for. The only difference is the build
 * label the launch link carries, and it is stamped here rather than left to whoever is packaging:
 * the Edge listing went live on 2026-09-02 carrying the chrome-built archive, so every Edge install
 * has been reporting itself as chrome, which is the one question the label exists to answer.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_ENDPOINT } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = ['manifest.json', '_locales', 'icons', 'src'];
const STAGE = join(ROOT, 'build', 'stage');
const OUT = join(ROOT, 'build');
const TARGETS = ['chrome', 'edge'];

/**
 * `--target edge` or `--target=edge`. An unknown value refuses rather than falling back to chrome:
 * a typo would otherwise produce a correct-looking archive with the wrong label inside it.
 *
 * @param {string[]} argv
 */
function readTarget(argv) {
  const flag = argv.findIndex((a) => a === '--target' || a.startsWith('--target='));
  if (flag === -1) return 'chrome';
  const value = argv[flag].includes('=') ? argv[flag].split('=')[1] : argv[flag + 1];
  if (!TARGETS.includes(value)) {
    throw new Error(`--target takes one of ${TARGETS.join(', ')}, not ${JSON.stringify(value)}`);
  }
  return value;
}

const target = readTarget(process.argv.slice(2));
const version = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;
// Chrome keeps the bare name because `publish-extension.sh` and the store submission doc both name
// that exact file.
const zipPath = join(OUT, target === 'chrome'
  ? `trickybird-extension-${version}.zip`
  : `trickybird-${target}-${version}.zip`);

// Only this target's own output goes, not the whole folder: building both in sequence used to leave
// just the last one, which reads as a successful pair of builds and is not.
rmSync(STAGE, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(STAGE, { recursive: true });
// Nothing shipped starts with a dot, and a `.DS_Store` rode into every archive built from a tree.
const written = (/** @type {string} */ src) => !basename(src).startsWith('.');
for (const entry of SHIPPED) {
  cpSync(join(ROOT, entry), join(STAGE, entry), { recursive: true, filter: written });
}

// The label rides on every launch link, so it is stamped into the staged copy and the source stays
// as it is. Asserted rather than assumed: for the chrome target the replacement is a no-op, so a
// regex that had quietly stopped matching would only be caught on an edge build, and only after
// that archive was published.
const BUILD_DECL = /export const EXTENSION_BUILD = '[a-z]+';/;
const configPath = join(STAGE, 'src', 'config.js');
const declared = readFileSync(configPath, 'utf8');
if (!BUILD_DECL.test(declared)) {
  throw new Error('src/config.js no longer declares EXTENSION_BUILD in the shape this stamps');
}
writeFileSync(configPath, declared.replace(BUILD_DECL, `export const EXTENSION_BUILD = '${target}';`));
if (!readFileSync(configPath, 'utf8').includes(`EXTENSION_BUILD = '${target}';`)) {
  throw new Error(`the staged config does not declare the ${target} build`);
}

// The catalogue anchors, stamped the same way and for the same reason the label is: the source
// folder is mirrored to a public repository, so the names live in `anchors.json`, which git does not
// track. A missing or empty file is a hard failure rather than an empty list -- an archive that
// queries no anchor has no way to learn a new address, and it would look exactly like a good one.
// Anchored to the whole line rather than to the shape of the array: the declaration carries a
// JSDoc cast so an empty default types as string[], and a pattern that spelled the array out
// stopped matching the moment that cast arrived. The assertion below checks the result, which is
// the half that has to be exact.
const ANCHORS_DECL = /^  records: .*$/m;
const anchorsPath = join(ROOT, 'anchors.json');
if (!existsSync(anchorsPath)) {
  throw new Error(`no ${anchorsPath}: copy anchors.example.json and put the real names in it`);
}
const anchors = JSON.parse(readFileSync(anchorsPath, 'utf8')).records;
if (!Array.isArray(anchors) || !anchors.length || !anchors.every((a) => /^_fronts\.[a-z0-9.-]+$/.test(a))) {
  throw new Error('anchors.json must hold a non-empty `records` array of `_fronts.<domain>` names');
}
const beforeAnchors = readFileSync(configPath, 'utf8');
if (!ANCHORS_DECL.test(beforeAnchors)) {
  throw new Error('src/config.js no longer declares CATALOG.records in the shape this stamps');
}
const stamped = `  records: [${anchors.map((a) => `'${a}'`).join(', ')}],`;
writeFileSync(configPath, beforeAnchors.replace(ANCHORS_DECL, stamped));
if (!readFileSync(configPath, 'utf8').includes(stamped)) {
  throw new Error('the staged config does not carry the anchors');
}

// Optional: without it a build with no record has nowhere to walk.
const SEED_DECL = /^export const SEED_MIRRORS = .*$/m;
const seeds = JSON.parse(readFileSync(anchorsPath, 'utf8')).mirrors ?? [];
if (!Array.isArray(seeds) || !seeds.every((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h))) {
  throw new Error('anchors.json `mirrors` must be an array of bare hostnames');
}
if (seeds.length) {
  const beforeSeeds = readFileSync(configPath, 'utf8');
  if (!SEED_DECL.test(beforeSeeds)) {
    throw new Error('src/config.js no longer declares SEED_MIRRORS in the shape this stamps');
  }
  const stampedSeeds = `export const SEED_MIRRORS = [${seeds.map((h) => `'${h}'`).join(', ')}];`;
  writeFileSync(configPath, beforeSeeds.replace(SEED_DECL, stampedSeeds));
  if (!readFileSync(configPath, 'utf8').includes(stampedSeeds)) {
    throw new Error('the staged config does not carry the seed mirror');
  }
}

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

// Fixed mtime and fixed timezone together, on both calls: `touch` reads its argument in local time,
// so west of UTC the stamp lands before the 1980 floor a zip entry can hold and the bytes move.
const utc = { ...process.env, TZ: 'UTC' };
execFileSync('touch', ['-t', '198001010000', ...files], { env: utc });
execFileSync('zip', ['-qXr', zipPath, ...files.map((/** @type {string} */ f) => relative(STAGE, f))], {
  cwd: STAGE,
  env: utc,
});

const sha = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
rmSync(STAGE, { recursive: true, force: true });
console.log(`${relative(ROOT, zipPath)}\nsha256 ${sha}\n${files.length} files`);
console.log(`build: ${target}`);
console.log(`console origins: ${shipped.join(', ')}`);
