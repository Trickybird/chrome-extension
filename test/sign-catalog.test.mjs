// The signer is the only thing standing between a typo and a record no installed copy will take.
// `--verify` exists so a record is checked against the key that will actually judge it before it
// reaches DNS, and the case that matters most is the quiet one: a record signed with the wrong key
// parses, looks right, and is refused by every browser in the field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'sign-catalog.mjs');

/** Runs the tool and hands back the exit code instead of throwing, so a refusal is assertable. */
async function tool(/** @type {string[]} */ args) {
  try {
    const { stdout } = await run(process.execPath, [TOOL, ...args]);
    return { code: 0, out: stdout };
  } catch (err) {
    const e = /** @type {{ code?: number, stdout?: string, stderr?: string }} */ (err);
    return { code: e.code ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const dir = mkdtempSync(join(tmpdir(), 'tb-catalog-'));
const keyPath = join(dir, 'catalog-key.json');
await tool(['--keygen', '--out', keyPath]);

const signed = await tool(['--key', keyPath, '--version', '1', '--hosts', 'example.net']);
const RECORD = signed.out.split('\n').find((line) => line.startsWith('tb1 '));

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a record signed by a key verifies against that key', async () => {
  assert.ok(RECORD, 'the signer printed no record');
  const { code, out } = await tool(['--verify', RECORD, '--key', keyPath]);
  assert.equal(code, 0, out);
  assert.match(out, /ok/i);
});

test('the same record is refused against the key the extension actually ships', async () => {
  // No --key means CATALOG.publicKey from src/config.js, and this record was signed by a throwaway
  // pair. A pass here would mean the default path never read the shipped key at all.
  const { code, out } = await tool(['--verify', /** @type {string} */ (RECORD)]);
  assert.notEqual(code, 0, 'a foreign record verified against the shipped key');
  assert.match(out, /signature/i);
});

test('a tampered signature is refused', async () => {
  const parts = /** @type {string} */ (RECORD).split(' ');
  const flipped = parts[3][0] === 'A' ? 'B' : 'A';
  parts[3] = flipped + parts[3].slice(1);
  const { code } = await tool(['--verify', parts.join(' '), '--key', keyPath]);
  assert.notEqual(code, 0);
});

test('a record that is not a record is refused before any crypto runs', async () => {
  const { code, out } = await tool(['--verify', 'not a record at all', '--key', keyPath]);
  assert.notEqual(code, 0);
  assert.match(out, /parse|malformed|record/i);
});

test('--verify without a record prints usage', async () => {
  const { code, out } = await tool(['--verify']);
  assert.notEqual(code, 0);
  assert.match(out, /usage/i);
});
