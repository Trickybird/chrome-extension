import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT_ENDPOINTS } from '../src/config.js';

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

// One named host at install, and it is ours. Routing a site needs no access to that site, so the
// only address here is where sessions come from.
test('the only host granted at install is where sessions come from', () => {
  assert.deepEqual(manifest.host_permissions,
    DEFAULT_ENDPOINTS.map((/** @type {string} */ e) => `${e}/*`));
});

// Nothing in the extension calls permissions.request with an origin, so declaring optional host
// access would advertise a reach it cannot use. The settings screen that once added a session
// address is gone, and the declaration went with it.
test('no optional host access is declared, because none can be asked for', () => {
  assert.equal(manifest.optional_host_permissions, undefined);
});

test('permissions that would widen reach on install are absent', () => {
  const banned = ['proxy', 'tabs', 'cookies', 'management', 'scripting', 'webRequest', 'debugger', '<all_urls>'];
  const declared = [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? []),
    ...(manifest.host_permissions ?? [])];
  for (const p of banned) assert.ok(!declared.includes(p), `${p} must not be declared`);
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
