// The channel is open to every script running on our console origin, so these are the checks that
// decide what a message may do. A hole here is a tab sent somewhere nobody asked for.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

/** @type {any[]} */
let rules = [];
const local = /** @type {Record<string, any>} */ ({});
const session = /** @type {Record<string, any>} */ ({});
const navigated = /** @type {Record<number, string>} */ ({});
/** @type {((msg: any, sender: any, reply: (r: any) => void) => boolean)|null} */
let listener = null;
/** Tabs the browser has already lost, so a navigation to them throws the way Chrome's does. */
const closedTabs = new Set();

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
    update: async (/** @type {number} */ id, /** @type {any} */ { url }) => {
      if (closedTabs.has(id)) throw new Error('no such tab');
      navigated[id] = url;
    },
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

const { cancelLaunch, forgetLaunches, serveHandoff, startLaunch, sweepExpired } =
  await import('../src/handoff.js');
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
/** @type {{ tabId: number, nonce: string }[]} */
const started = [];

async function begin(tabId = 1) {
  await startLaunch({ tabId, url: TARGET });
  const nonce = navigated[tabId].split('#ticket=')[1];
  started.push({ tabId, nonce });
  return nonce;
}

// A launch nobody finished is still being watched, and a pending timer keeps the runner alive.
afterEach(() => {
  for (const { tabId, nonce } of started.splice(0)) forgetLaunches(tabId, [nonce]);
});

beforeEach(() => {
  rules = [];
  clear(local);
  clear(session);
  clear(navigated);
  closedTabs.clear();
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

/*
 * A cancel from a tab that is still fenced used to send it home behind its own fence, and the fence
 * lets nothing but the gateway through, so the address it was sent to was blocked by us and blamed
 * on "an extension" by the browser.
 */
test('cancelling takes the fence off before sending the tab home', async () => {
  await startLaunch({ tabId: 1, url: TARGET, originalUrl: 'https://news.example/list' });
  // Whatever put it there, a tab wearing a fence must not be sent anywhere the fence refuses.
  // The shape `readTabRule` looks for: the tab-scoped rule that records which proxy this tab is on.
  rules = [{
    id: 4,
    priority: 2,
    action: { type: 'allow' },
    condition: { tabIds: [1], requestDomains: ['gw-1.example'], resourceTypes: ['main_frame'] },
  }];

  await cancelLaunch({ tabId: 1 });

  assert.equal(rules.filter((r) => r.condition.tabIds?.[0] === 1).length, 0,
    'the tab was sent home behind its own fence');
  assert.equal(navigated[1], 'https://news.example/list');
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

/*
 * An expired record is the last thing holding the address someone asked for, and the sweep is what
 * turns it into a retry. Every write used to prune the whole set on its way past, so a launch in
 * another tab, or a cancel, or a tab closing, reaped that record before anyone could look at it, and
 * the panel fell through to the bare expired state with nothing to offer.
 */
test('a launch in another tab does not reap an expired record before it can be offered', async () => {
  const nonce = await begin();
  session.pending[nonce].createdAt -= 6 * 60 * 1000;

  await startLaunch({ tabId: 2, url: 'https://other.example/', originalUrl: 'https://other.example/' });

  await sweepExpired(1);
  assert.deepEqual(session.offers, { 1: { url: TARGET, reason: 'error', code: 'TB-106' } });
});

/*
 * The console asking for the address used to disarm the watchdog outright, so a console that spoke
 * once and then died — network gone, mint hung, tab navigated away by hand — had no timeout at all.
 * The badge stayed busy, the record aged out in silence, and the only recovery was opening the popup
 * on that exact tab.
 */
test('a console that asks and then goes quiet still gets answered', async () => {
  const nonce = await begin();

  // The watchdog is module-private and should stay that way, so this drives the clock rather than
  // reaching for the timer: what a person would see is the offer, not the callback. Enabled before
  // the answer, because a timer already scheduled by the real clock is not one a mock can reach.
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await say({ v: 1, op: 'pending', nonce });
    mock.timers.tick(10 * 60 * 1000);
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  } finally {
    mock.timers.reset();
  }

  assert.ok(session.offers?.[1], 'the launch was left with nothing watching it');
});

test('a launch still inside its window is left where it is', async () => {
  const nonce = await begin();
  await sweepExpired(1);
  assert.deepEqual(session.offers ?? {}, {});
  assert.equal((await readPending(nonce))?.url, TARGET);
});

/*
 * The record is opened before the navigation and was not consumed when the navigation failed, so a
 * tab closed in that window left a live record bound to a dead id. `onRemoved` has already run by
 * then and found nothing to drop.
 */
test('a tab that dies before its launch navigates leaves no record behind', async () => {
  closedTabs.add(9);
  await assert.rejects(startLaunch({ tabId: 9, url: TARGET, originalUrl: TARGET }), /TB-10/);
  assert.deepEqual(session.pending ?? {}, {}, 'a record survived the tab it was opened for');
});

test('a tab with no launch behind it sweeps to nothing', async () => {
  await begin(1);
  session.pending[Object.keys(session.pending)[0]].createdAt -= 6 * 60 * 1000;
  await sweepExpired(9);
  assert.deepEqual(session.offers ?? {}, {}, 'another tab\'s launch is not this tab\'s failure');
});
