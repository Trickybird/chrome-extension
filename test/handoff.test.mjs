// The channel is open to every script running on our console origin, so these are the checks that
// decide what a message may do. A hole here is a tab sent somewhere nobody asked for.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** @type {any[]} */
let rules = [];
const local = /** @type {Record<string, any>} */ ({});
const session = /** @type {Record<string, any>} */ ({});
const navigated = /** @type {Record<number, string>} */ ({});
/** @type {((msg: any, sender: any, reply: (r: any) => void) => boolean)|null} */
let listener = null;

/** The doubles close over these objects, so a fresh test clears them in place. */
const clear = (/** @type {Record<string, any>} */ bag) => {
  for (const key of Object.keys(bag)) delete bag[key];
};

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
    query: async () => [],
  },
  storage: { local: store(local), session: store(session) },
  action: {
    setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {},
    setBadgeTextColor: async () => {}, setTitle: async () => {},
  },
  i18n: { getMessage: (/** @type {string} */ k) => k },
  runtime: {
    onMessageExternal: { addListener: (/** @type {any} */ fn) => { listener = fn; } },
    getManifest: () => ({ externally_connectable: { matches: ['https://trickybird.com/*'] } }),
  },
};

const { cancelLaunch, serveHandoff, startLaunch, sweepExpired } = await import('../src/handoff.js');
const { readPending } = await import('../src/pending.js');
serveHandoff();

const CONSOLE = 'https://trickybird.com';
const TARGET = 'https://news.example/article';
const enc = (/** @type {string} */ s) => Buffer.from(s).toString('base64url');
const bootstrapFor = (/** @type {string} */ target) =>
  `https://gw-1.example/_session?sId=abc&d=${enc(target)}`;

/** Speaks to the extension the way the console does, and waits for the reply. */
const say = (/** @type {any} */ msg, /** @type {any} */ sender = { origin: CONSOLE }) =>
  new Promise((resolve) => {
    /** @type {any} */ (listener)(msg, sender, resolve);
  });

/** Starts a launch and returns the nonce the extension parked it under. */
async function begin(tabId = 1) {
  await startLaunch({ tabId, url: TARGET });
  return navigated[tabId].split('#ticket=')[1];
}

beforeEach(() => {
  rules = [];
  clear(local);
  clear(session);
  clear(navigated);
});

test('the console is told which address the nonce stands for', async () => {
  const nonce = await begin();
  assert.deepEqual(await say({ v: 1, op: 'pending', nonce }), { ok: true, url: TARGET });
});

test('asking twice is allowed, because the page may reload', async () => {
  const nonce = await begin();
  await say({ v: 1, op: 'pending', nonce });
  assert.deepEqual(await say({ v: 1, op: 'pending', nonce }), { ok: true, url: TARGET });
});

test('a bootstrap for the address we parked fences the tab and moves it', async () => {
  const nonce = await begin();
  await say({ v: 1, op: 'pending', nonce });
  assert.deepEqual(await say({ v: 1, op: 'handoff', nonce, proxyUrl: bootstrapFor(TARGET) }),
    { ok: true });
  assert.equal(navigated[1], bootstrapFor(TARGET));
  assert.ok(rules.some((r) => r.condition.tabIds[0] === 1), 'the tab went unfenced');
});

test('a spent nonce cannot be handed off twice', async () => {
  const nonce = await begin();
  await say({ v: 1, op: 'handoff', nonce, proxyUrl: bootstrapFor(TARGET) });
  navigated[1] = 'unchanged';
  assert.deepEqual(await say({ v: 1, op: 'handoff', nonce, proxyUrl: bootstrapFor(TARGET) }),
    { ok: false });
  assert.equal(navigated[1], 'unchanged');
});

// The attack the destination pin exists for: our shape, our path, a token that parses, and a site
// of the sender's choosing behind it.
test('a bootstrap for a different address moves nothing', async () => {
  const nonce = await begin();
  const before = navigated[1];
  assert.deepEqual(
    await say({ v: 1, op: 'handoff', nonce, proxyUrl: bootstrapFor('https://attacker.example/') }),
    { ok: false });
  assert.equal(navigated[1], before);
  assert.deepEqual(rules, []);
});

// Found in a real browser: a refusal used to spend the nonce, so one message from any script on
// the console origin killed a launch it had no way to redirect. The pin makes the attempt useless;
// it must not also make it effective.
test('a refused bootstrap leaves the launch open for the real one', async () => {
  const nonce = await begin();
  await say({ v: 1, op: 'handoff', nonce, proxyUrl: bootstrapFor('https://attacker.example/') });
  assert.deepEqual(await say({ v: 1, op: 'handoff', nonce, proxyUrl: bootstrapFor(TARGET) }),
    { ok: true });
  assert.equal(navigated[1], bootstrapFor(TARGET));
});

test('a message from another origin is not heard at all', async () => {
  const nonce = await begin();
  assert.deepEqual(await say({ v: 1, op: 'pending', nonce }, { origin: 'https://elsewhere.example' }),
    { ok: false });
});

test('a version we do not recognise is refused', async () => {
  const nonce = await begin();
  assert.deepEqual(await say({ v: 2, op: 'pending', nonce }), { ok: false });
});

test('an operation we do not recognise is refused', async () => {
  const nonce = await begin();
  assert.deepEqual(await say({ v: 1, op: 'whatever', nonce }), { ok: false });
});

test('a nonce nobody issued is refused', async () => {
  await begin();
  assert.deepEqual(await say({ v: 1, op: 'pending', nonce: 'AAAAAAAAAAAAAAAAAAAAAA' }),
    { ok: false });
});

// The channel names a tab; a sender in a different one is either confused or lying.
test('a sender in another tab is refused', async () => {
  const nonce = await begin(1);
  assert.deepEqual(await say({ v: 1, op: 'pending', nonce }, { origin: CONSOLE, tab: { id: 9 } }),
    { ok: false });
});

test('a sender in the tab we navigated is heard', async () => {
  const nonce = await begin(1);
  assert.deepEqual(await say({ v: 1, op: 'pending', nonce }, { origin: CONSOLE, tab: { id: 1 } }),
    { ok: true, url: TARGET });
});

test('a failed mint releases the launch instead of leaving it parked', async () => {
  const nonce = await begin();
  assert.deepEqual(await say({ v: 1, op: 'failed', nonce, reason: 'rate_limited' }), { ok: true });
  assert.equal(await readPending(nonce), null);
});

// The tab is sitting on our console showing the console's own error, and this record is the last
// copy of the address anyone asked for. Dropping it silently is what left the popup with nothing to
// offer but a description of the site already on screen.
test('a failed mint keeps the address so it can be offered again', async () => {
  const nonce = await begin();
  await say({ v: 1, op: 'failed', nonce, reason: 'rate_limited' });
  assert.deepEqual(session.offers, { 1: { url: TARGET, reason: 'error', code: 'TB-101' } });
});

test('a launch the person stopped leaves nothing behind', async () => {
  const nonce = await begin();
  await say({ v: 1, op: 'failed', nonce, reason: 'cancelled' });
  assert.deepEqual(session.offers ?? {}, {}, 'their own decision is not a failure to retry');
});

test('the address the console answered with goes first next time', async () => {
  const nonce = await begin();
  await say({ v: 1, op: 'pending', nonce });
  assert.equal(local.lastGoodEndpoint, CONSOLE);
});

// A person looking at our site, waiting to press a button they have decided not to press. Without
// this the panel is a spinner with no other answer in it.
test('cancelling a launch puts the tab back where it started', async () => {
  await startLaunch({ tabId: 1, url: TARGET, originalUrl: 'https://news.example/list' });
  assert.match(navigated[1], /trickybird\.com/);

  assert.deepEqual(await cancelLaunch({ tabId: 1 }), { ok: true });
  assert.equal(navigated[1], 'https://news.example/list');
  assert.deepEqual(session.pending, {}, 'the launch is spent, not merely hidden');
});

test('cancelling when nothing is in flight moves nothing', async () => {
  navigated[1] = 'untouched';
  assert.deepEqual(await cancelLaunch({ tabId: 1 }), { ok: true });
  assert.equal(navigated[1], 'untouched');
});

// A name the sender chose must never reach the prototype chain: every object literal answers to
// `constructor` and `toString`, and dispatching on one throws inside the listener instead of
// refusing.
for (const op of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
  test(`an op named ${op} is refused, not dispatched`, async () => {
    const nonce = await begin();
    assert.deepEqual(await say({ v: 1, op, nonce }), { ok: false });
  });
}

test('an op that is not a string is refused', async () => {
  const nonce = await begin();
  assert.deepEqual(await say({ v: 1, op: 42, nonce }), { ok: false });
  assert.deepEqual(await say({ v: 1, op: null, nonce }), { ok: false });
});

// Nothing fires when a record runs out of time: no event, no timer that outlives the worker. Left
// alone it takes the address with it, and the tab is still standing on the console it was sent to.
test('a launch that ran out of time becomes an offer to try it again', async () => {
  const nonce = await begin();
  session.pending[nonce].createdAt -= 6 * 60 * 1000;
  await sweepExpired(1);
  assert.deepEqual(session.offers, { 1: { url: TARGET, reason: 'error', code: 'TB-106' } });
  assert.equal(await readPending(nonce), null);
});

test('a launch still inside its window is left where it is', async () => {
  const nonce = await begin();
  await sweepExpired(1);
  assert.deepEqual(session.offers ?? {}, {});
  assert.equal((await readPending(nonce))?.url, TARGET);
});

test('a tab with no launch behind it sweeps to nothing', async () => {
  await begin(1);
  session.pending[Object.keys(session.pending)[0]].createdAt -= 6 * 60 * 1000;
  await sweepExpired(9);
  assert.deepEqual(session.offers ?? {}, {}, 'another tab\'s launch is not this tab\'s failure');
});
