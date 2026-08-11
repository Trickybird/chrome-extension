import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateBaseId, buildTabRules, MAX_RULE_ID, PRIORITY, readTabRule, ruleIdsForBase,
} from '../src/rules.js';

/** @param {object} [over] */
const spec = (over = {}) => ({
  tabId: 7, origin: 'https://example.com', endpoint: 'https://proxy.example', baseId: 1, ...over,
});

test('every rule is scoped to one tab', () => {
  for (const rule of buildTabRules(spec({ tabId: 42 }))) {
    assert.deepEqual(rule.condition.tabIds, [42], `rule ${rule.id}`);
  }
});

/*
 * This is why the extension never asks for access to a site. Chrome requires host access for
 * `redirect` and `modifyHeaders` and for no other action, so a table built from `allow` and `block`
 * alone works with nothing granted. One redirect rule anywhere in here brings the whole per-site
 * permission dialog back, which is why it is asserted rather than remembered.
 */
test('no rule uses an action that would need access to the site', () => {
  const actions = buildTabRules(spec()).map((r) => r.action.type);
  assert.deepEqual([...new Set(actions)].sort(), ['allow', 'block']);
});

test('a local address outranks the catch-all', () => {
  const rules = buildTabRules(spec());
  /** @param {string} type */
  const by = (type) => /** @type {any} */ (rules.find((r) => r.action.type === type));
  assert.equal(by('allow').priority, PRIORITY.allowPrivate);
  assert.equal(by('block').priority, PRIORITY.catchAll);
  assert.ok(by('allow').priority > by('block').priority);
});

// Containment is the product claim. A catch-all that only covers documents lets scripts, images
// and websockets leave the tab unrouted while the interface says the tab is contained.
test('the catch-all covers every request type, not only documents', () => {
  const block = /** @type {any} */ (buildTabRules(spec()).find((r) => r.action.type === 'block'));
  for (const type of ['sub_frame', 'script', 'image', 'xmlhttprequest', 'websocket', 'media', 'other']) {
    assert.ok(block.condition.resourceTypes.includes(type), `catch-all must cover ${type}`);
  }
});

test('the catch-all never blocks the proxy itself', () => {
  const block = /** @type {any} */ (buildTabRules(spec()).find((r) => r.action.type === 'block'));
  assert.deepEqual(block.condition.excludedRequestDomains, ['proxy.example']);
});

test('a local address is never routed, whatever was asked for', () => {
  assert.throws(() => buildTabRules(spec({ origin: 'http://192.168.1.1' })), /private/i);
});

// Rule ids were once derived from the tab id. A real tab id is around 7e8, and three times that
// overflows the signed 32-bit field the rule API uses, so nothing installed at all.
test('ids come from what is installed, never from a tab id', () => {
  const installed = [{ id: 900 }, { id: 4 }];
  assert.equal(allocateBaseId(installed), 901);
  assert.equal(allocateBaseId([]), 1);
  const rules = buildTabRules(spec({ tabId: 737170051, baseId: allocateBaseId(installed) }));
  for (const r of rules) {
    assert.ok(Number.isInteger(r.id) && r.id >= 1 && r.id <= MAX_RULE_ID, `id ${r.id}`);
  }
});

test('a base with no room for its rules is refused rather than truncated', () => {
  assert.throws(() => buildTabRules(spec({ baseId: MAX_RULE_ID - 1 })), /range/i);
  assert.throws(() => allocateBaseId([{ id: MAX_RULE_ID }]), /exhausted/i);
});

test('ids within a base are contiguous and unique', () => {
  const rules = buildTabRules(spec({ baseId: 10 }));
  assert.deepEqual(rules.map((r) => r.id), ruleIdsForBase(10));
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
});

// Installed rules are the record of which tabs are fenced and through which proxy, so reading them
// back has to survive a service worker restart with no other state.
test('installed rules read back to the tab they fence', () => {
  const rules = buildTabRules(spec({ tabId: 55, baseId: 4 }));
  const read = /** @type {any} */ (readTabRule(rules, 55));
  assert.equal(read.endpointHost, 'proxy.example');
  assert.equal(read.baseId, 4);
  assert.deepEqual(ruleIdsForBase(read.baseId), rules.map((r) => r.id));
});

test('an unrouted tab reads back as nothing', () => {
  assert.equal(readTabRule(buildTabRules(spec({ tabId: 55 })), 56), null);
  assert.equal(readTabRule([], 1), null);
});

test('local addresses are exempt and lookalike names are not', () => {
  const patterns = buildTabRules(spec())
    .filter((r) => r.action.type === 'allow')
    .map((r) => new RegExp(String(r.condition.regexFilter)));
  /** @param {string} u */
  const exempt = (u) => patterns.some((re) => re.test(u));

  for (const u of [
    'http://192.168.1.1/', 'http://127.0.0.1:8080/x', 'http://10.1.2.3/', 'http://172.20.0.1/',
    'https://nas.local/', 'http://nas/', 'http://[::1]/', 'http://[fd00::1]/',
  ]) {
    assert.ok(exempt(u), `${u} must be exempt`);
  }
  for (const u of [
    'https://127.evil.com/', 'https://localhost.evil.com/', 'https://fcbarcelona.com/',
    'https://example.com/', 'https://172.32.0.1/',
  ]) {
    assert.ok(!exempt(u), `${u} must not be exempt`);
  }
});

// Chrome rejects a regexFilter whose compiled form exceeds its budget, and the rule set then fails
// to install at all. The limit is not on source length, so this guards the real constraint loosely.
test('each local pattern stays well short of the compile budget', () => {
  for (const rule of buildTabRules(spec()).filter((r) => r.action.type === 'allow')) {
    const pattern = String(rule.condition.regexFilter);
    assert.ok(pattern.length < 120, `pattern too large: ${pattern.length}`);
  }
});
