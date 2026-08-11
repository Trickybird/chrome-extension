import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Refused, verifyBootstrap } from '../src/bootstrap-url.js';

const TARGET = 'https://news.example/article?id=7';
const enc = (/** @type {string} */ s) => Buffer.from(s).toString('base64url');
/** The exact shape buildBootstrapUrl emits. */
const bootstrap = (/** @type {string} */ target, extra = '') =>
  `https://gw-1.example/_session?sId=abc.def&d=${enc(target)}${extra}`;

test('a real bootstrap for the address we asked for is accepted', () => {
  assert.deepEqual(verifyBootstrap(bootstrap(TARGET), TARGET),
    { ok: true, endpoint: 'https://gw-1.example' });
});

// A share-link mint appends `&j=1`. Extra parameters are the API's business, not ours.
test('parameters we do not know about are not our business', () => {
  const result = verifyBootstrap(bootstrap(TARGET, '&j=1'), TARGET);
  assert.equal(result.ok, true);
});

test('a non-ASCII address survives the round trip', () => {
  const target = 'https://example.org/статья';
  assert.equal(verifyBootstrap(bootstrap(target), target).ok, true);
});

test('cleartext is refused', () => {
  assert.deepEqual(
    verifyBootstrap(`http://gw-1.example/_session?sId=t&d=${enc(TARGET)}`, TARGET),
    { ok: false, reason: Refused.scheme });
});

test('anything that is not a URL is refused', () => {
  assert.deepEqual(verifyBootstrap('not a url', TARGET), { ok: false, reason: Refused.scheme });
});

test('a host on the local network is refused', () => {
  assert.deepEqual(
    verifyBootstrap(`https://192.168.1.9/_session?sId=t&d=${enc(TARGET)}`, TARGET),
    { ok: false, reason: Refused.private });
});

test('a path that is not the bootstrap is refused', () => {
  assert.deepEqual(
    verifyBootstrap(`https://gw-1.example/anything?sId=t&d=${enc(TARGET)}`, TARGET),
    { ok: false, reason: Refused.path });
});

test('a bootstrap with no session token is refused', () => {
  assert.deepEqual(
    verifyBootstrap(`https://gw-1.example/_session?sId=&d=${enc(TARGET)}`, TARGET),
    { ok: false, reason: Refused.sid });
});

// The one that matters: a script on the console origin presenting the right SHAPE but its own
// destination. Same host, same path, a token that parses -- and a different site behind `d`.
test('a bootstrap for a different address is refused', () => {
  assert.deepEqual(
    verifyBootstrap(bootstrap('https://attacker.example/'), TARGET),
    { ok: false, reason: Refused.target });
});

test('a d that is not decodable is refused', () => {
  assert.deepEqual(
    verifyBootstrap('https://gw-1.example/_session?sId=t&d=!!!!', TARGET),
    { ok: false, reason: Refused.target });
});

test('a missing d is refused', () => {
  assert.deepEqual(
    verifyBootstrap('https://gw-1.example/_session?sId=t', TARGET),
    { ok: false, reason: Refused.target });
});
