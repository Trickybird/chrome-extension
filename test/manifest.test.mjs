import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT_ENDPOINTS, DEV_ENDPOINT } from '../src/config.js';

/** @param {string} p */
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const manifest = read('../manifest.json');
const messages = read('../_locales/en/messages.json');

// The permission set is the product's central claim, so it is asserted rather than reviewed.
test('nothing is requested at install beyond what the popup needs to open', () => {
  assert.deepEqual(manifest.permissions,
    ['declarativeNetRequest', 'storage', 'activeTab', 'contextMenus']);
  assert.deepEqual(manifest.optional_permissions, ['webNavigation']);
});

// No host at all, because nothing here makes a request any more: the console opens the session and
// hands back the address, and moving a tab needs no access to anything.
test('no host is granted at install, because nothing asks one for anything', () => {
  assert.equal(manifest.host_permissions, undefined);
});

// Nothing in the extension calls permissions.request with an origin, so declaring optional host
// access would advertise a reach it cannot use. The settings screen that once added a session
// address is gone, and the declaration went with it.
test('no optional host access is declared, because none can be asked for', () => {
  assert.equal(manifest.optional_host_permissions, undefined);
});

// The key names who may speak to the extension. A sub-domain wildcard would name the gateway hosts
// too, and every page we proxy runs its own JavaScript there.
test('only exact console origins may talk to the extension', () => {
  const matches = manifest.externally_connectable?.matches;
  assert.ok(matches, 'the console channel is how a launch finishes');
  // The shipped addresses and the local one a developer runs, named rather than tolerated: this list
  // decides who can move the rule table, so growing it has to be a deliberate edit here too.
  assert.deepEqual(matches,
    [...DEFAULT_ENDPOINTS, DEV_ENDPOINT].map((/** @type {string} */ e) => `${e}/*`));
  for (const m of matches) assert.ok(!m.includes('*.'), `${m} must name one host`);
  assert.equal(manifest.externally_connectable.ids, undefined, 'no cross-extension channel');
});

// `.test` is reserved and never resolves publicly, which is the whole reason the entry above is
// harmless. A real domain slipping in beside it would not be.
test('the development origin is a name that cannot exist on the internet', () => {
  assert.match(DEV_ENDPOINT, /^https:\/\/[a-z0-9-]+\.test$/);
});

test('permissions that would widen reach on install are absent', () => {
  const banned = ['proxy', 'tabs', 'cookies', 'management', 'scripting', 'webRequest', 'debugger', '<all_urls>'];
  const declared = [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? []),
    ...(manifest.host_permissions ?? [])];
  for (const p of banned) assert.ok(!declared.includes(p), `${p} must not be declared`);
});

// The product's whole argument is that it never asks for a site. One `permissions.request` carrying
// an origin anywhere in the source turns that into a lie, and nothing else in here reads the source.
test('nothing anywhere asks for access to a site', () => {
  const sources = readdirSync(new URL('../src/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
    .join('\n');
  for (const [, arg] of sources.matchAll(/permissions\.request\(([^)]*)\)/g)) {
    assert.ok(!/origins/.test(arg), `permissions.request asks for an origin: ${arg}`);
  }
});

// The address list is walked on an event and never on a clock. A background poll is a shape in the
// traffic that says this extension is installed, and it buys nothing an event does not.
test('nothing polls on a timer', () => {
  for (const file of readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.ok(!/setInterval\s*\(/.test(source), `${file} sets an interval`);
    assert.ok(!/chrome\.alarms/.test(source), `${file} uses alarms`);
  }
});

test('no content scripts and no remotely hosted code', () => {
  assert.equal(manifest.content_scripts, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
});

test('every name the manifest references resolves to a string', () => {
  for (const value of [manifest.name, manifest.description, manifest.action.default_title]) {
    const key = /^__MSG_(.+)__$/.exec(value)?.[1];
    assert.ok(key, `${value} should be a message reference`);
    assert.ok(messages[key]?.message, `${key} missing from the catalog`);
  }
});

test('the store card stays inside the length Chrome shows', () => {
  assert.ok(messages.extName.message.length <= 45, 'name');
  assert.ok(messages.extDesc.message.length <= 132, 'short description');
});

test('every declared icon exists', () => {
  const files = new Set(readdirSync(new URL('../icons/', import.meta.url)));
  for (const path of Object.values(manifest.icons)) {
    assert.ok(files.has(path.split('/').pop()), `${path} missing`);
  }
});

// A catalog entry nobody reads is dead weight, and a lookup with no entry renders empty.
test('catalog entries and code references agree', async () => {
  const sources = readdirSync(new URL('../src/', import.meta.url))
    .filter((f) => f.endsWith('.js') || f.endsWith('.html'))
    .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
    .join('\n');
  const referenced = new Set([...sources.matchAll(/['"]([a-z][A-Za-z0-9]+)['"]/g)].map((m) => m[1]));
  const unused = Object.keys(messages)
    .filter((k) => !k.startsWith('ext'))
    .filter((k) => !referenced.has(k));
  assert.deepEqual(unused, [], 'catalog keys no surface reads');
});
