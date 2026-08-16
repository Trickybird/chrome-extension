// What the settings page can and cannot take away from an install.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const local = /** @type {Record<string, any>} */ ({});

/** @type {any} */ (globalThis).chrome = {
  storage: {
    local: {
      get: async (/** @type {string} */ key) => ({ [key]: local[key] }),
      set: async (/** @type {any} */ patch) => { Object.assign(local, patch); },
    },
  },
};

const { DEFAULT_ENDPOINTS, readSettings, writeSettings } = await import('../src/config.js');

beforeEach(() => {
  for (const key of Object.keys(local)) delete local[key];
});

test('a fresh install opens the address that ships', async () => {
  assert.deepEqual((await readSettings()).endpoints, DEFAULT_ENDPOINTS);
});

// The settings copy promises a move to another of our addresses when the first stops answering.
// Replacing the list instead of leading it left an install with exactly one address, so a typo in
// that field took away the only console the extension could reach and the promise with it.
test('a hand-typed address leads, and the one that ships stays behind it', async () => {
  await writeSettings({ endpoints: ['https://tb-front.test'] });
  assert.deepEqual((await readSettings()).endpoints, ['https://tb-front.test', ...DEFAULT_ENDPOINTS]);
});

test('clearing the field leaves the address that ships', async () => {
  await writeSettings({ endpoints: ['https://tb-front.test'] });
  await writeSettings({ endpoints: [] });
  assert.deepEqual((await readSettings()).endpoints, DEFAULT_ENDPOINTS);
});

// Someone who typed our own address by hand should not end up dialling it twice on the way down.
test('typing the address that ships does not duplicate it', async () => {
  await writeSettings({ endpoints: [...DEFAULT_ENDPOINTS] });
  assert.deepEqual((await readSettings()).endpoints, DEFAULT_ENDPOINTS);
});

// The pre-1.1 shape kept a single address under its own key.
test('an address carried over from the old shape also keeps the shipped one behind it', async () => {
  Object.assign(local, { settings: { sessionEndpoint: 'https://old.example' } });
  assert.deepEqual((await readSettings()).endpoints, ['https://old.example', ...DEFAULT_ENDPOINTS]);
});

test('autoRecover is off until someone turns it on', async () => {
  assert.equal((await readSettings()).autoRecover, false);
  await writeSettings({ autoRecover: true });
  assert.equal((await readSettings()).autoRecover, true);
});
