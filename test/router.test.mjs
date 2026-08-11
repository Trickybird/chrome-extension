// The fence is the product. These cover the one property that matters: a tab that is fenced stays
// fenced until someone takes it out, whatever happens in other tabs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** @type {any[]} */
let rules = [];
/** @type {Record<string, any>} */
let local = {};
/** @type {Record<string, any>} */
let session = {};
/** @type {Record<number, string>} */
let navigated = {};

const store = (/** @type {Record<string, any>} */ bag) => ({
  get: async (/** @type {string} */ key) => ({ [key]: bag[key] }),
  set: async (/** @type {any} */ patch) => { Object.assign(bag, patch); },
});

/** @type {any} */ (globalThis).chrome = {
  declarativeNetRequest: {
    getSessionRules: async () => rules,
    updateSessionRules: async (/** @type {any} */ { addRules = [], removeRuleIds = [] }) => {
      rules = rules.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
  },
  tabs: {
    get: async (/** @type {number} */ id) => ({ id }),
    update: async (/** @type {number} */ id, /** @type {any} */ { url }) => { navigated[id] = url; },
    query: async () => [{ id: 1 }, { id: 2 }],
  },
  storage: { local: store(local), session: store(session) },
  action: {
    setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {},
    setBadgeTextColor: async () => {}, setTitle: async () => {},
  },
  i18n: { getMessage: (/** @type {string} */ k) => k },
};

/** The session mint, answered without a network. */
globalThis.fetch = /** @type {any} */ (async (/** @type {any} */ url) => ({
  ok: true,
  status: 200,
  json: async () => ({ proxyUrl: `https://proxy.example/_session?d=${new URL(String(url)).host}` }),
}));

const { forgetTab, route, routedTabs, stateOf, unroute } = await import('../src/router.js');

beforeEach(() => {
  rules = [];
  local = {};
  session = {};
  navigated = {};
});

test('routing a tab fences it and sends it to the proxy', async () => {
  const result = await route({ tabId: 1, url: 'https://example.com/' });
  assert.equal(result.ok, true);
  assert.match(navigated[1], /^https:\/\/proxy\.example\//);
  assert.ok(rules.length > 0);
  assert.ok(rules.every((r) => r.condition.tabIds[0] === 1));
});

/*
 * The regression this file exists for. A new route used to remove every session rule, so routing a
 * second tab silently stripped the first one's fence while it was still showing a proxied page:
 * contained one moment, free to reach anywhere the next, with nothing said to anyone.
 */
test('routing a second tab leaves the first one fenced', async () => {
  await route({ tabId: 1, url: 'https://one.example/' });
  const first = rules.filter((r) => r.condition.tabIds[0] === 1).map((r) => r.id);
  assert.ok(first.length > 0);

  await route({ tabId: 2, url: 'https://two.example/' });
  const stillThere = rules.filter((r) => r.condition.tabIds[0] === 1).map((r) => r.id);
  assert.deepEqual(stillThere, first, 'tab 1 lost its fence when tab 2 was routed');
  assert.ok(rules.some((r) => r.condition.tabIds[0] === 2));
});

test('rule ids never collide between tabs', async () => {
  await route({ tabId: 1, url: 'https://one.example/' });
  await route({ tabId: 2, url: 'https://two.example/' });
  const ids = rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('re-routing the same tab replaces its rules rather than stacking them', async () => {
  await route({ tabId: 1, url: 'https://one.example/' });
  const count = rules.length;
  await route({ tabId: 1, url: 'https://two.example/' });
  assert.equal(rules.length, count);
});

test('taking a tab out removes only its own rules', async () => {
  await route({ tabId: 1, url: 'https://one.example/' });
  await route({ tabId: 2, url: 'https://two.example/' });
  await unroute({ tabId: 2, url: 'https://two.example/' });
  assert.ok(rules.some((r) => r.condition.tabIds[0] === 1));
  assert.ok(!rules.some((r) => r.condition.tabIds[0] === 2));
  assert.equal(navigated[2], 'https://two.example/');
});

test('a closed tab leaves nothing behind, because Chrome reuses tab ids', async () => {
  await route({ tabId: 1, url: 'https://one.example/' });
  await forgetTab(1);
  assert.deepEqual(rules, []);
  assert.equal((await stateOf(1)).routed, false);
});

test('the settings list names every fenced tab', async () => {
  await route({ tabId: 1, url: 'https://one.example/' });
  await route({ tabId: 2, url: 'https://two.example/' });
  const listed = await routedTabs();
  assert.deepEqual(listed.map((r) => r.origin).sort(),
    ['https://one.example', 'https://two.example']);
});

test('a tab showing a page on our proxy reads back as proven', async () => {
  await route({ tabId: 1, url: 'https://example.com/' });
  const proxied = 'https://proxy.example/_o/aHR0cHM6Ly9leGFtcGxlLmNvbQ/';
  const state = await stateOf(1, proxied);
  assert.equal(state.routed, true);
  assert.equal(state.proven, true);
  assert.equal(state.origin, 'https://example.com');
});

test('a fenced tab whose address cannot be read is unknown, not stale', async () => {
  await route({ tabId: 1, url: 'https://example.com/' });
  // activeTab lapses the moment the tab navigates, so this is the ordinary case, not an edge one.
  const state = await stateOf(1);
  assert.equal(state.routed, true);
  assert.equal(state.proven, null, 'unreadable must not read as a tab that went somewhere else');
});

test('a fenced tab showing something else is not proven', async () => {
  await route({ tabId: 1, url: 'https://example.com/' });
  const state = await stateOf(1, 'https://example.com/');
  assert.equal(state.routed, true);
  assert.equal(state.proven, false);
  assert.equal(state.origin, 'https://example.com', 'the label is the fallback when unproven');
});
