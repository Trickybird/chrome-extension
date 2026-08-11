// Storage is not a lock. Every set here is a read, a change and a write, and the browser is free to
// run the next one in the middle of it.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Record<string, any>} */
let disk = {};
/** @type {any} */ (globalThis).chrome = {
  storage: {
    session: {
      get: async (/** @type {string} */ key) => ({ [key]: disk[key] }),
      // A write that takes a turn to land, which is what the queue exists for.
      set: async (/** @type {Record<string, any>} */ patch) => {
        await new Promise((r) => setTimeout(r, 1));
        disk = { ...disk, ...patch };
      },
    },
  },
};

const { sessionMap } = await import('../src/session-map.js');

beforeEach(() => { disk = {}; });

test('changes made at the same moment all survive', async () => {
  const store = sessionMap('things');
  await Promise.all(['a', 'b', 'c', 'd'].map((id) =>
    store.update((records) => [{ ...records, [id]: id.toUpperCase() }, null])));
  assert.deepEqual(await store.read(), { a: 'A', b: 'B', c: 'C', d: 'D' });
});

test('an update reads what the one before it wrote', async () => {
  const store = sessionMap('counter');
  await Promise.all(Array.from({ length: 5 }, () =>
    store.update((r) => [{ ...r, n: (Number(r.n) || 0) + 1 }, null])));
  assert.equal((await store.read()).n, 5);
});

test('the set that comes back unchanged is not written', async () => {
  const store = sessionMap('quiet');
  await store.update((records) => [records, null]);
  assert.equal(disk.quiet, undefined);
});

test('a change that throws does not wedge the ones behind it', async () => {
  const store = sessionMap('resilient');
  await assert.rejects(store.update(() => { throw new Error('no'); }));
  await store.update((records) => [{ ...records, ok: true }, null]);
  assert.deepEqual(await store.read(), { ok: true });
});

test('an update hands back what its change returned', async () => {
  const store = sessionMap('result');
  assert.equal(await store.update((r) => [{ ...r, x: 1 }, 'taken']), 'taken');
});
