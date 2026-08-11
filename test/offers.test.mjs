import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Just enough browser to exercise the store and the badge. */
const badge = new Map();
const titles = new Map();
/** @type {Record<string, any>} */
let store = {};

// Through globalThis-as-any: assigning to the declared global would rewrite chrome's type for
// every file in the program, and the rest of the suite would stop being checked.
/** @type {any} */ (globalThis).chrome = {
  storage: {
    session: {
      get: async (/** @type {string} */ key) => ({ [key]: store[key] }),
      set: async (/** @type {Record<string, any>} */ patch) => { store = { ...store, ...patch }; },
    },
  },
  action: {
    setBadgeText: async (/** @type {any} */ { tabId, text }) => { badge.set(tabId, text); },
    setBadgeBackgroundColor: async () => {},
    setBadgeTextColor: async () => {},
    setTitle: async (/** @type {any} */ { tabId, title }) => { titles.set(tabId, title); },
  },
  i18n: { getMessage: (/** @type {string} */ key) => key },
};

const { drop, get, put } = await import('../src/offers.js');

beforeEach(() => {
  store = {};
  badge.clear();
  titles.clear();
});

test('an offer is kept for its own tab and shows on its own icon', async () => {
  await put(7, 'https://example.com/', 'link');
  assert.deepEqual(await get(7), { url: 'https://example.com/', reason: 'link' });
  assert.equal(badge.get(7), '!');
  assert.equal(await get(8), null);
});

// Colour is never the only carrier, so the mark carries a tooltip that says the same thing.
test('the mark comes with words', async () => {
  await put(7, 'https://example.com/', 'link');
  assert.equal(titles.get(7), 'badgeAttention');
  await drop(7);
  assert.equal(titles.get(7), 'extName');
});

// Two failures in one tab are one suggestion, not a queue nobody asked for.
test('a second offer for the same tab replaces the first', async () => {
  await put(7, 'https://one.example/', 'failed');
  await put(7, 'https://two.example/', 'link');
  assert.deepEqual(await get(7), { url: 'https://two.example/', reason: 'link' });
});

test('dropping one leaves the other tab alone', async () => {
  await put(7, 'https://a.example/', 'link');
  await put(8, 'https://b.example/', 'link');
  await drop(7);
  assert.equal(await get(7), null);
  assert.equal(badge.get(7), '');
  assert.deepEqual(await get(8), { url: 'https://b.example/', reason: 'link' });
  assert.equal(badge.get(8), '!');
});

test('dropping a tab that had nothing still clears its badge', async () => {
  await drop(9);
  assert.equal(badge.get(9), '');
});

// A failure of ours keeps its code, so the popup can name what went wrong instead of telling the
// person their browser could not reach a site it reached perfectly well.
test('our own failure carries its code, a page that would not load does not', async () => {
  await put(7, 'https://example.com/', 'error', 'TB-103');
  assert.deepEqual(await get(7), { url: 'https://example.com/', reason: 'error', code: 'TB-103' });
  await put(8, 'https://example.com/', 'failed');
  assert.deepEqual(await get(8), { url: 'https://example.com/', reason: 'failed' });
});
