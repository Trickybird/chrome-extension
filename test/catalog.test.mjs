// The record decides where every installed copy goes looking. A verifier that accepts one byte more
// than the signer meant is a redirect for anyone who can answer a DNS query.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { acceptsCatalog, parseCatalog, verifyCatalog } from '../src/catalog.js';

const { subtle } = webcrypto;
const CURVE = { name: 'ECDSA', namedCurve: 'P-256' };
const b64url = (/** @type {ArrayBuffer} */ b) => Buffer.from(b).toString('base64url');

const pair = await subtle.generateKey(CURVE, true, ['sign', 'verify']);
const PUBLIC = b64url(await subtle.exportKey('raw', pair.publicKey));
const other = await subtle.generateKey(CURVE, true, ['sign', 'verify']);
const OTHER_PUBLIC = b64url(await subtle.exportKey('raw', other.publicKey));

/** Signs exactly what the tool signs, so the test proves the pair and not one implementation. */
async function record(/** @type {number} */ version, /** @type {string[]} */ hosts,
  key = pair.privateKey) {
  const signed = new TextEncoder().encode(`tb-fronts-v1|${version}|${hosts.join(',')}`);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed);
  return `tb1 ${version} ${hosts.join(',')} ${b64url(sig)}`;
}

test('a record the tool signed is parsed and verified', async () => {
  const parsed = parseCatalog(await record(3, ['a.example', 'b.example']));
  assert.ok(parsed);
  assert.equal(parsed.version, 3);
  assert.deepEqual(parsed.hosts, ['a.example', 'b.example']);
  assert.equal(await verifyCatalog(parsed, PUBLIC), true);
});

test('a record signed by anyone else is refused', async () => {
  const parsed = parseCatalog(await record(3, ['a.example'], other.privateKey));
  assert.ok(parsed);
  assert.equal(await verifyCatalog(parsed, PUBLIC), false);
});

test('our own record does not verify against a stranger key', async () => {
  const parsed = parseCatalog(await record(3, ['a.example']));
  assert.equal(await verifyCatalog(/** @type {any} */ (parsed), OTHER_PUBLIC), false);
});

// The attack the signature exists to stop: a resolver that answers with a list of its own.
test('adding a host to a signed record breaks it', async () => {
  const signed = await record(3, ['a.example']);
  const tampered = signed.replace('a.example', 'a.example,evil.example');
  const parsed = parseCatalog(tampered);
  assert.ok(parsed, 'it still parses, which is why the signature has to catch it');
  assert.deepEqual(parsed.hosts, ['a.example', 'evil.example']);
  assert.equal(await verifyCatalog(parsed, PUBLIC), false);
});

test('moving the version breaks it', async () => {
  const parsed = parseCatalog((await record(3, ['a.example'])).replace('tb1 3', 'tb1 9'));
  assert.equal(await verifyCatalog(/** @type {any} */ (parsed), PUBLIC), false);
});

for (const [label, text] of [
  ['wrong prefix', 'tb2 1 a.example AAAA'],
  ['too few fields', 'tb1 1 a.example'],
  ['too many fields', 'tb1 1 a.example AAAA extra'],
  ['version zero', 'tb1 0 a.example AAAA'],
  ['version not a number', 'tb1 x a.example AAAA'],
  ['no hosts', 'tb1 1  AAAA'],
  ['host carries a scheme', 'tb1 1 https://a.example AAAA'],
  ['host carries a path', 'tb1 1 a.example/x AAAA'],
  ['host carries a port', 'tb1 1 a.example:8443 AAAA'],
  ['single label', 'tb1 1 localhost AAAA'],
  ['signature is not base64url', 'tb1 1 a.example !!!!'],
  ['empty', ''],
]) {
  test(`${label} is refused before any crypto runs`, () => {
    assert.equal(parseCatalog(text), null);
  });
}

test('a duplicate host is refused', async () => {
  assert.equal(parseCatalog(await record(1, ['a.example', 'a.example'])), null);
});

test('a signature of the wrong length never reaches WebCrypto', () => {
  assert.equal(parseCatalog('tb1 1 a.example AAAA'), null);
});

// Forward only, or a censor replays a real record from before the addresses he blocked existed.
for (const [label, version, stored, floor, want] of [
  ['newer than stored is taken', 5, 4, 1, true],
  ['equal to stored is refused', 4, 4, 1, false],
  ['older than stored is refused', 3, 4, 1, false],
  ['below the shipped floor is refused even with nothing stored', 2, 0, 3, false],
  ['at the shipped floor with nothing stored is taken', 3, 0, 3, true],
]) {
  test(String(label), () => {
    assert.equal(
      acceptsCatalog(/** @type {any} */ ({ version }), Number(stored), Number(floor)), want);
  });
}
