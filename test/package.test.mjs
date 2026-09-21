/*
 * The packager, run for real. Nothing drove it before: the archive that reaches a store was produced
 * by a script whose only check was a developer reading its output.
 *
 * What it has to get right, and each of these is silent when wrong: the chrome archive must not move
 * (publish-extension.sh and the submission doc name that file), the edge archive must
 * carry the edge label, an unknown target must refuse rather than quietly produce a chrome build,
 * building one target must not delete the other, the developer's own console must be stripped from
 * both, and nothing the platform leaves in the folder may ride along.
 *
 * Each test builds from its own copy of the folder carrying a fixture `anchors.json`. The real one is
 * untracked, so a checkout that never had it could not run these at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;
const CHROME_ZIP = `trickybird-extension-${version}.zip`;
const EDGE_ZIP = `trickybird-edge-${version}.zip`;

// Reserved names, which check-extension-publishable.mjs exempts for exactly this reason.
const ANCHORS = {
  records: ['_fronts.example.test', '_fronts.example.invalid'],
  mirrors: ['mirror.example'],
};

/** @param {import('node:test').TestContext} t */
function stage(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tb-pack-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Copied as it stands, the platform's leavings included: one of these tests is about dropping them.
  cpSync(ROOT, dir, {
    recursive: true,
    filter: (src) => !/^(?:node_modules|build)(?:[/\\]|$)/.test(relative(ROOT, src)),
  });
  writeFileSync(join(dir, 'anchors.json'), JSON.stringify(ANCHORS));
  return dir;
}

const pack = (/** @type {string} */ dir, /** @type {string[]} */ args = [], /** @type {string} */ tz = 'UTC') =>
  execFileSync(process.execPath, [join(dir, 'tools', 'package.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, TZ: tz },
  });

const zip = (/** @type {string} */ dir, /** @type {string} */ name) => join(dir, 'build', name);

const sha = (/** @type {string} */ path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/** One file's text, read out of the archive rather than out of the staging directory. */
const fromZip = (/** @type {string} */ path, /** @type {string} */ entry) =>
  execFileSync('unzip', ['-p', path, entry], { encoding: 'utf8' });

const entries = (/** @type {string} */ path) =>
  execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).split('\n').filter(Boolean);

test('the default target is chrome, and its archive keeps the name the publish script looks for', (t) => {
  const dir = stage(t);
  assert.match(pack(dir), /build: chrome/);
  assert.ok(existsSync(zip(dir, CHROME_ZIP)), 'the chrome archive is not where publish-extension.sh looks');
  assert.match(fromZip(zip(dir, CHROME_ZIP), 'src/config.js'), /EXTENSION_BUILD = 'chrome';/);
});

test('the anchors reach the archive and never the source it was built from', (t) => {
  const dir = stage(t);
  pack(dir);
  const config = fromZip(zip(dir, CHROME_ZIP), 'src/config.js');
  assert.match(config, /records: \['_fronts\.example\.test', '_fronts\.example\.invalid'\]/);
  assert.match(config, /SEED_MIRRORS = \['mirror\.example'\]/);
  // Stamped into the staged copy, so the folder it was built from comes out of a build unchanged.
  assert.doesNotMatch(readFileSync(join(dir, 'src', 'config.js'), 'utf8'), /example\.(?:test|invalid)/);
});

test('the same target twice produces the same bytes', (t) => {
  const dir = stage(t);
  pack(dir);
  const first = sha(zip(dir, CHROME_ZIP));
  pack(dir);
  assert.equal(sha(zip(dir, CHROME_ZIP)), first, 'two builds of one commit must be checkable against each other');
});

// `touch` reads its argument in local time, so west of UTC the stamp fell below the floor a zip
// entry can hold and the bytes moved. It held here only because this machine sits east of it.
test('the archive does not move with the machine timezone', (t) => {
  const dir = stage(t);
  pack(dir, [], 'Asia/Tokyo');
  const east = sha(zip(dir, CHROME_ZIP));
  rmSync(join(dir, 'build'), { recursive: true, force: true });
  pack(dir, [], 'America/Los_Angeles');
  assert.equal(sha(zip(dir, CHROME_ZIP)), east, 'the same tree packs differently either side of UTC');
});

test('the edge target stamps the edge label and leaves the chrome archive alone', (t) => {
  const dir = stage(t);
  pack(dir);
  const chrome = sha(zip(dir, CHROME_ZIP));

  assert.match(pack(dir, ['--target', 'edge']), /build: edge/);
  assert.ok(existsSync(zip(dir, EDGE_ZIP)), 'no edge archive was produced');
  assert.match(fromZip(zip(dir, EDGE_ZIP), 'src/config.js'), /EXTENSION_BUILD = 'edge';/);
  // The label is the whole difference, so the two archives must not be the same bytes.
  assert.notEqual(sha(zip(dir, EDGE_ZIP)), chrome);
  // And building one must not take the other with it, which is what wiping the folder used to do.
  assert.ok(existsSync(zip(dir, CHROME_ZIP)), 'the edge build deleted the chrome archive');
  assert.equal(sha(zip(dir, CHROME_ZIP)), chrome, 'the edge build rewrote the chrome archive');
});

test('--target=edge is accepted in the joined form too', (t) => {
  assert.match(pack(stage(t), ['--target=edge']), /build: edge/);
});

test('an unknown target refuses and produces nothing', (t) => {
  const dir = stage(t);
  assert.throws(() => pack(dir, ['--target', 'safari']), /--target takes one of chrome, edge/);
  assert.equal(existsSync(zip(dir, CHROME_ZIP)), false, 'a refused target still wrote the chrome archive');
  assert.equal(existsSync(zip(dir, EDGE_ZIP)), false, 'a refused target still wrote an archive');
});

test('a build with no anchors refuses rather than shipping one that can learn no address', (t) => {
  const dir = stage(t);
  rmSync(join(dir, 'anchors.json'));
  assert.throws(() => pack(dir), /anchors\.json/);
  assert.equal(existsSync(zip(dir, CHROME_ZIP)), false);
});

test('neither archive carries the developer console', (t) => {
  const dir = stage(t);
  pack(dir);
  pack(dir, ['--target', 'edge']);
  for (const [name, path] of [['chrome', zip(dir, CHROME_ZIP)], ['edge', zip(dir, EDGE_ZIP)]]) {
    const manifest = JSON.parse(fromZip(path, 'manifest.json'));
    assert.deepEqual(manifest.externally_connectable.matches, ['https://trickybird.com/*'], name);
  }
});

// A `.DS_Store` carries the window geometry of whoever built it, and rode into every archive built
// from a working tree.
test('nothing the platform leaves in the folder reaches the archive', (t) => {
  const dir = stage(t);
  writeFileSync(join(dir, '_locales', '.DS_Store'), 'leavings');
  pack(dir);
  const hidden = entries(zip(dir, CHROME_ZIP)).filter((e) => basename(e).startsWith('.'));
  assert.deepEqual(hidden, [], 'the archive carries files nobody wrote');
});
