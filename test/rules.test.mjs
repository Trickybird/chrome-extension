import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateIds, buildFence, buildMarker, FENCE_RULES, MAX_RULE_ID, PRIORITY, readFence, readTabRule,
  routedEndpoints,
} from '../src/rules.js';

/** @param {object} [over] */
const marker = (over = {}) => buildMarker({
  tabId: 7, origin: 'https://example.com', endpoint: 'https://proxy.example', id: 1, ...over,
});

/** @param {object} [over] */
const fence = (over = {}) => buildFence({
  endpoint: 'https://proxy.example', consoleHosts: ['trickybird.com'], baseId: 10, ...over,
});

/** @param {chrome.declarativeNetRequest.Rule[]} rules @param {string} type */
const by = (rules, type) => /** @type {any} */ (rules.find((r) => r.action.type === type));

/*
 * The proxied page has its own ways home that the extension does not drive: the toolbar's home
 * button, and the redirect the gateway sends when a session runs out. Both are a top-level
 * navigation to our console, and a fence that excluded only the gateway blocked them, so a session
 * simply expiring put the person on Chrome's "blocked by an extension" page with nothing pressed.
 *
 * Only the top-level navigation is opened. Opening the console by name in the block's exclusions
 * instead let a proxied page fetch, ping and beacon it too, and those are the request types it would
 * use to say something about the reader — on our own origin, where it looks like our own traffic.
 */
test('the way home is open, and only as a whole page', () => {
  const home = by(fence({ consoleHosts: ['trickybird.com', 'tb-front.test'] }), 'allow');
  assert.deepEqual(home.condition.requestDomains, ['trickybird.com', 'tb-front.test']);
  assert.deepEqual(home.condition.resourceTypes, ['main_frame']);
  assert.equal(home.condition.tabIds, undefined, 'the web console user has no tab of ours');
  assert.ok(home.priority > PRIORITY.fence, 'the fence would outrank the way home');

  const block = by(fence(), 'block');
  assert.deepEqual(block.condition.excludedRequestDomains, ['proxy.example'],
    'naming the console here would open it to every request type, not just navigation');
});

test('a fence with nowhere to call home is refused rather than built open', () => {
  assert.throws(() => fence({ consoleHosts: [] }), /console/i);
});

/*
 * The fence holds the page and nothing else. Everything a proxied page asks for carries the gateway
 * as its initiator, and one rule scoped to that catches all of it, navigation included. The tab it
 * happens to be sitting in is the person's: an address they type, a bookmark, the back button and a
 * link another app opens all arrive with no initiator at all, and a rule scoped to the tab refused
 * them too. That cost them their tab, and worse, it cost them the page they went to — its
 * stylesheets and scripts were refused the same way, so leaving left them with a broken site.
 *
 * The one thing a tab-scoped rule uniquely caught was a request with no initiator raised from INSIDE
 * a proxied page, which means a document with an opaque origin. Those belong to the gateway, which is
 * where they are closed for the people who never installed this, and where what remains open is
 * written down.
 */
test('nothing in the fence is scoped to a tab', () => {
  for (const rule of fence()) {
    assert.equal(rule.condition.tabIds, undefined, `rule ${rule.id}`);
    assert.deepEqual(rule.condition.initiatorDomains, ['proxy.example']);
  }
});

test('the fence covers every request type, not only documents', () => {
  const block = by(fence(), 'block');
  for (const type of ['main_frame', 'sub_frame', 'script', 'image', 'xmlhttprequest', 'websocket',
    'media', 'other']) {
    assert.ok(block.condition.resourceTypes.includes(type), `the fence must cover ${type}`);
  }
  assert.equal(block.condition.resourceTypes.length, 15);
});

/*
 * A device on your own network stays yours, and it needs no rule of its own: the block is scoped to
 * what the proxied page asks for, and a request the PERSON makes carries no initiator, so nothing
 * stands in front of it. What must still hold is the other half — the page reaching that same
 * address — and the block is what holds it.
 */
test('a private address is refused to the page and left alone for the person', () => {
  const rules = fence({ endpoint: 'https://gw-1.example' });
  assert.equal(rules.filter((r) => r.condition.regexFilter).length, 0,
    'a rule that exempts an address by pattern outranks the block and hands it to the page');
  const block = by(rules, 'block');
  assert.equal(block.condition.excludedRequestDomains.includes('192.168.1.1'), false,
    'nothing private is excluded from the block, so the page reaches none of it');
});

test('a local address is never routed, whatever was asked for', () => {
  assert.throws(() => marker({ origin: 'http://192.168.1.1' }), /private/i);
});

/*
 * This is why the extension never asks for access to a site. Chrome requires host access for
 * `redirect` and `modifyHeaders` and for no other action, so a table built from `allow` and `block`
 * alone works with nothing granted. One redirect rule anywhere in here brings the whole per-site
 * permission dialog back, which is why it is asserted rather than remembered.
 */
test('no rule uses an action that would need access to the site', () => {
  const actions = [marker(), ...fence()].map((r) => r.action.type);
  assert.deepEqual([...new Set(actions)].sort(), ['allow', 'block']);
});

// The marker is a record, not a permission. It allows a whole-page load from the gateway, which the
// fence already permits by excluding that host, so nothing it names can widen what the page reaches.
test('the marker names one host and grants nothing the fence had not already', () => {
  const rule = /** @type {any} */ (marker({ tabId: 42 }));
  assert.deepEqual(rule.condition.tabIds, [42]);
  assert.deepEqual(rule.condition.requestDomains, ['proxy.example']);
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
  assert.equal(rule.action.type, 'allow');
  assert.equal(by(fence(), 'block').condition.excludedRequestDomains.includes('proxy.example'), true);
});

// Rule ids were once derived from the tab id. A real tab id is around 7e8, and three times that
// overflows the signed 32-bit field the rule API uses, so nothing installed at all.
test('ids come from what is installed, never from a tab id', () => {
  assert.deepEqual(allocateIds([{ id: 900 }, { id: 4 }], 3), [901, 902, 903]);
  assert.deepEqual(allocateIds([], 1), [1]);
  const rule = marker({ tabId: 737170051, id: allocateIds([{ id: 900 }], 1)[0] });
  assert.ok(Number.isInteger(rule.id) && rule.id >= 1 && rule.id <= MAX_RULE_ID, `id ${rule.id}`);
});

test('a base with no room for its rules is refused rather than truncated', () => {
  assert.doesNotThrow(() => fence({ baseId: MAX_RULE_ID - FENCE_RULES + 1 }));
  assert.throws(() => fence({ baseId: MAX_RULE_ID }), /range/i);
  assert.throws(() => marker({ id: 0 }), /range/i);
  assert.throws(() => allocateIds([{ id: MAX_RULE_ID }], 1), /exhausted/i);
});

test('ids within a fence are contiguous and unique', () => {
  const ids = fence({ baseId: 10 }).map((r) => r.id);
  assert.deepEqual(ids, [10, 11]);
  assert.equal(new Set(ids).size, FENCE_RULES);
});

// Installed rules are the record of which tabs are fenced and through which proxy, so reading them
// back has to survive a service worker restart with no other state.
test('installed rules read back to the tab they mark', () => {
  const rules = [marker({ tabId: 55, id: 4 }), ...fence()];
  assert.deepEqual(readTabRule(rules, 55), { id: 4, endpointHost: 'proxy.example' });
  assert.equal(readTabRule(rules, 56), null);
  assert.equal(readTabRule([], 1), null);
});

/*
 * The fence stands per gateway, not per tab. Behind every fenced tab it stood once per tab, and the
 * last tab to be forgotten took browser-wide containment away with it — including from a tab the
 * page itself had opened, which is a moment the page gets to choose. It also meant N copies whose
 * console lists were each frozen at a different moment, so the effective policy was their
 * intersection and a newly added console host stayed shut until the oldest fence went.
 */
test('one fence answers for every tab behind it', () => {
  const rules = [
    marker({ tabId: 1, id: 1 }), marker({ tabId: 2, id: 2 }),
    marker({ tabId: 3, id: 3, endpoint: 'https://gw-2.example' }),
    ...fence({ baseId: 10 }), ...fence({ endpoint: 'https://gw-2.example', baseId: 20 }),
  ];
  assert.deepEqual([...routedEndpoints(rules)].sort(), ['gw-2.example', 'proxy.example']);
  assert.deepEqual(readFence(rules, 'proxy.example'), [10, 11]);
  assert.deepEqual(readFence(rules, 'gw-2.example'), [20, 21]);
  assert.deepEqual(readFence(rules, 'nobody.example'), []);

  const afterOneTabLeaves = rules.filter((r) => r.id !== 1);
  assert.ok(routedEndpoints(afterOneTabLeaves).has('proxy.example'),
    'a tab still behind this fence, so the fence stays');
});
