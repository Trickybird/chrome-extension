// The fence is the product. These cover the one property that matters: a tab that is fenced stays
// fenced until someone takes it out, whatever happens in other tabs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** @type {any[]} */
let rules = [];
const local = /** @type {Record<string, any>} */ ({});
const session = /** @type {Record<string, any>} */ ({});
const navigated = /** @type {Record<number, string>} */ ({});
/** @type {Set<number>} */
let closed = new Set();
/** Rules the browser refuses to install, by base id, so a failed install can be exercised. */
let refuseInstall = false;

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
      if (addRules.length && refuseInstall) return;
      rules = rules.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
  },
  tabs: {
    get: async (/** @type {number} */ id) => {
      if (closed.has(id)) throw new Error('no such tab');
      return { id };
    },
    update: async (/** @type {number} */ id, /** @type {any} */ { url }) => {
      if (closed.has(id)) throw new Error('no such tab');
      navigated[id] = url;
    },
    query: async () => [{ id: 1 }, { id: 2 }],
  },
  storage: { local: store(local), session: store(session) },
  action: {
    setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {},
    setBadgeTextColor: async () => {}, setTitle: async () => {},
  },
  i18n: { getMessage: (/** @type {string} */ k) => k },
  // The channel list Chrome enforces; the code reads it rather than keeping a second copy.
  runtime: {
    getManifest: () => ({ externally_connectable: { matches: ['https://trickybird.com/*'] } }),
  },
};

/** @type {string[]} */
let fetched = [];
/** Hosts the probe should treat as dead. */
let unreachable = new Set();

// The only request the extension may make is the reachability probe. A mint would be a regression,
// so anything that is not a probe throws.
globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url) => {
  fetched.push(String(url));
  if (!String(url).endsWith('/api/health')) {
    throw new Error(`the extension must not request ${url}`);
  }
  if ([...unreachable].some((h) => String(url).includes(h))) throw new Error('unreachable');
  return { ok: true, status: 200 };
});

const { fence, forgetIfLeft, forgetTab, launch, routedTabs, stateOf, unroute } =
  await import('../src/router.js');
const { carriesTicket } = await import('../src/fragment.js');

const BOOTSTRAP = 'https://proxy.example/_session?sId=t&d=x';

/** What the old `route` did in one call: fence the tab and send it to the proxy. */
const routeTo = (/** @type {number} */ tabId, /** @type {string} */ origin) =>
  fence({ tabId, targetOrigin: origin, proxyUrl: BOOTSTRAP });

beforeEach(() => {
  rules = [];
  clear(local);
  clear(session);
  clear(navigated);
  closed = new Set();
  refuseInstall = false;
  fetched = [];
  unreachable = new Set();
});

test('fencing a tab holds it and sends it to the proxy', async () => {
  const result = await routeTo(1, 'https://example.com');
  assert.equal(result.ok, true);
  assert.equal(navigated[1], BOOTSTRAP);
  assert.ok(rules.length > 0);
  assert.ok(rules.filter((r) => r.condition.tabIds).every((r) => r.condition.tabIds?.[0] === 1));
  const tabless = rules.filter((r) => r.condition.initiatorDomains);
  assert.deepEqual(tabless.map((r) => r.action.type).sort(), ['allow', 'block'],
    'the fence is the block on what the proxy origin asks, plus the one way home');
});

/*
 * The fence names no tab, so one of it answers for every tab behind it. A copy per tab meant the
 * last tab to be forgotten took browser-wide containment with it, and a page that had opened a
 * second tab of its own got to pick that moment.
 */
test('a second tab through the same gateway adds a marker and no second fence', async () => {
  await routeTo(1, 'https://one.example');
  const fenceIds = rules.filter((r) => r.condition.initiatorDomains).map((r) => r.id);
  await routeTo(2, 'https://two.example');
  assert.deepEqual(rules.filter((r) => r.condition.initiatorDomains).map((r) => r.id), fenceIds);
  assert.equal(rules.filter((r) => r.condition.tabIds).length, 2);
});

test('the fence outlives every tab but the last, and goes with it', async () => {
  await routeTo(1, 'https://one.example');
  await routeTo(2, 'https://two.example');
  await forgetTab(1);
  assert.ok(rules.some((r) => r.condition.initiatorDomains), 'tab 2 is still behind this fence');
  await forgetTab(2);
  assert.deepEqual(rules, [], 'nothing is routed, so nothing is left installed');
});

/*
 * The regression this file exists for. A new route used to remove every session rule, so routing a
 * second tab silently stripped the first one's fence while it was still showing a proxied page:
 * contained one moment, free to reach anywhere the next, with nothing said to anyone.
 */
test('fencing a second tab leaves the first one fenced', async () => {
  await routeTo(1, 'https://one.example');
  const first = rules.filter((r) => r.condition.tabIds?.[0] === 1).map((r) => r.id);
  assert.ok(first.length > 0);

  await routeTo(2, 'https://two.example');
  const stillThere = rules.filter((r) => r.condition.tabIds?.[0] === 1).map((r) => r.id);
  assert.deepEqual(stillThere, first, 'tab 1 lost its fence when tab 2 was routed');
  assert.ok(rules.some((r) => r.condition.tabIds?.[0] === 2));
});

test('rule ids never collide between tabs', async () => {
  await routeTo(1, 'https://one.example');
  await routeTo(2, 'https://two.example');
  const ids = rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('re-fencing the same tab replaces its rules rather than stacking them', async () => {
  await routeTo(1, 'https://one.example');
  const count = rules.length;
  await routeTo(1, 'https://two.example');
  assert.equal(rules.length, count);
});

/*
 * Our own console is what the tab shows for the whole of a launch, between the fence going in and
 * the navigation to the proxy landing. A panel opened in that window would read it as the person
 * having walked away and retire the fence they are about to need. A proxied page can also put the
 * tab there by itself, which would let it choose when that happens.
 */
test('the console is not evidence that anyone left', async () => {
  await routeTo(1, 'https://one.example');
  const installed = rules.map((r) => r.id);
  await forgetIfLeft(1, 'https://trickybird.com/?ext=1#tb=abc');
  assert.deepEqual(rules.map((r) => r.id), installed, 'a launch in flight lost its own fence');
});

test('taking a tab out removes only its own rules', async () => {
  await routeTo(1, 'https://one.example');
  await routeTo(2, 'https://two.example');
  await unroute({ tabId: 2, url: 'https://two.example/' });
  assert.ok(rules.some((r) => r.condition.tabIds?.[0] === 1));
  assert.ok(!rules.some((r) => r.condition.tabIds?.[0] === 2));
  assert.equal(navigated[2], 'https://two.example/');
});

/*
 * Leaving the proxy is not an event anybody can hear. The fence holds the page, not the tab, so an
 * address the person types is simply allowed and nothing fires; the record that this tab was routed
 * then outlives the routing, and the panel goes on offering to stop something that already stopped.
 *
 * Nothing needs to watch for it. The panel reads the tab's address to draw itself, and an address
 * that is plainly not ours is the evidence — checked where somebody is already looking, which is the
 * same bargain `sweepExpired` makes.
 */
test('an address that is plainly not ours retires the record', async () => {
  await routeTo(1, 'https://one.example');
  await routeTo(2, 'https://two.example');

  await forgetIfLeft(1, 'https://github.com/');

  assert.equal(rules.filter((r) => r.condition.tabIds?.[0] === 1).length, 0);
  assert.ok(rules.some((r) => r.condition.tabIds?.[0] === 2), 'the other tab lost its own record');
  assert.equal((await stateOf(1)).routed, false);
});

test('a tab still on the proxy keeps its record', async () => {
  await routeTo(1, 'https://one.example');
  await forgetIfLeft(1, 'https://proxy.example/_o/aHR0cHM6Ly9vbmUuZXhhbXBsZQ/');
  assert.ok(rules.some((r) => r.condition.tabIds?.[0] === 1), 'a proxied page was read as a departure');
});

// activeTab lapses the moment the tab navigates, so an unreadable address is the ordinary case. It
// is not evidence of anything, and acting on it would unfence a tab that never went anywhere.
test('an address we cannot read is not evidence of leaving', async () => {
  await routeTo(1, 'https://one.example');
  await forgetIfLeft(1, undefined);
  await forgetIfLeft(1, 'chrome://settings');
  assert.ok(rules.some((r) => r.condition.tabIds?.[0] === 1));
});

test('a closed tab leaves nothing behind, because Chrome reuses tab ids', async () => {
  await routeTo(1, 'https://one.example');
  await forgetTab(1);
  assert.deepEqual(rules, []);
  assert.equal((await stateOf(1)).routed, false);
});

test('the settings list names every fenced tab', async () => {
  await routeTo(1, 'https://one.example');
  await routeTo(2, 'https://two.example');
  const listed = await routedTabs();
  assert.deepEqual(listed.map((r) => r.origin).sort(),
    ['https://one.example', 'https://two.example']);
});

test('a tab showing a page on our proxy reads back as proven', async () => {
  await routeTo(1, 'https://example.com');
  const proxied = 'https://proxy.example/_o/aHR0cHM6Ly9leGFtcGxlLmNvbQ/';
  const state = await stateOf(1, proxied);
  assert.equal(state.routed, true);
  assert.equal(state.proven, true);
  assert.equal(state.origin, 'https://example.com');
});

test('a fenced tab whose address cannot be read is unknown, not stale', async () => {
  await routeTo(1, 'https://example.com');
  // activeTab lapses the moment the tab navigates, so this is the ordinary case, not an edge one.
  const state = await stateOf(1);
  assert.equal(state.routed, true);
  assert.equal(state.proven, null, 'unreadable must not read as a tab that went somewhere else');
});

test('a fenced tab showing something else is not proven', async () => {
  await routeTo(1, 'https://example.com');
  const state = await stateOf(1, 'https://example.com/');
  assert.equal(state.routed, true);
  assert.equal(state.proven, false);
  assert.equal(state.origin, 'https://example.com', 'the label is the fallback when unproven');
});

// A launch in flight is what separates "waiting on a press" from "nothing is happening", and it
// carries the only address a cancel can return the tab to.
test('a tab mid-launch reports where it came from', async () => {
  await launch({ tabId: 5, url: 'https://news.example/article',
    originalUrl: 'https://news.example/list' });
  const state = await stateOf(5, 'https://trickybird.com/');
  assert.equal(state.routed, false);
  assert.equal(state.waitingFrom, 'https://news.example/list');
});

// Found by a person standing on a proxied page with a panel that offered to open it again: an
// address that cannot answer us never gets a fence installed, and the popup read only the fence.
test('a proxied page with no fence still reads as ours', async () => {
  const state = await stateOf(99, 'https://proxy.example/_o/aHR0cHM6Ly9leGFtcGxlLmNvbQ/');
  assert.equal(state.routed, false, 'there is no fence, and saying otherwise would be a lie');
  assert.equal(state.proxied, true, 'but the page came through us, so the way out has to be offered');
  assert.equal(state.origin, 'https://example.com');
});

test('a tab on an ordinary page is neither fenced nor ours', async () => {
  const state = await stateOf(99, 'https://example.com/');
  assert.equal(state.routed, false);
  assert.equal(state.proxied, false);
});

// The read-back is what separates "rules were asked for" from "rules are in place". Without it a
// silent install failure would put a proxied page in a tab with nothing holding it in.
test('rules that did not take stop the navigation and leave nothing behind', async () => {
  refuseInstall = true;
  await assert.rejects(routeTo(1, 'https://example.com'), /TB-101/);
  assert.equal(navigated[1], undefined);
  assert.deepEqual(rules, []);
});

// Chrome hands a closed tab's id to the next tab, so a fence left behind lands on a stranger's.
test('a tab that dies after its rules are in place takes them with it', async () => {
  const dying = 3;
  const original = chrome.tabs.update;
  /** @type {any} */ (chrome.tabs).update = async (/** @type {number} */ id) => {
    if (id === dying) throw new Error('no such tab');
  };
  await assert.rejects(fence({ tabId: dying, targetOrigin: 'https://example.com', proxyUrl: BOOTSTRAP }),
    /TB-105/);
  /** @type {any} */ (chrome.tabs).update = original;
  assert.deepEqual(rules, [], 'the fence outlived the tab it was built for');
});

// ---- launch: the tab goes to the console, and nothing else happens here ----

test('a launch sends the tab to the shipped address with a nonce and no destination', async () => {
  const result = await launch({ tabId: 1, url: 'https://news.example/article' });
  assert.equal(result.ok, true);
  const [base, fragment] = navigated[1].split('#');
  assert.equal(base, 'https://trickybird.com/?ext=chrome');
  assert.match(fragment, /^ticket=[A-Za-z0-9_-]{22}$/);
  assert.ok(!navigated[1].includes('news.example'), 'the destination must not ride in the URL');
  assert.deepEqual(rules, [], 'a launch fences nothing: the fence waits for the session');
  // The popup reads this back to tell a launch in flight from one whose record is gone, so what is
  // written here has to be what that reader recognises.
  assert.equal(carriesTicket(navigated[1]), true);
});

// An ordinary parameter, so the tag reads it with no code of ours. It names the build rather than
// just saying "an extension": the second browser we ship would otherwise be indistinguishable from
// the first in every report.
test('the launch names the build it came from', async () => {
  await launch({ tabId: 1, url: 'https://news.example/article' });
  assert.ok(navigated[1].includes('?ext=chrome'));
});

// A mirror is not in externally_connectable and cannot answer, so it gets the destination itself.
// Without this a mirror launch would sit through the watchdog and then give up, every time.
test('an address from the record carries the destination instead of a nonce', async () => {
  local.fronts = { version: 2, hosts: ['mirror.example'] };
  unreachable = new Set(['trickybird.com']);

  const result = await launch({ tabId: 1, url: 'https://news.example/article' });
  assert.equal(result.endpoint, 'https://mirror.example');
  assert.equal(result.nonce, undefined, 'a mirror gets no nonce, because nothing can spend it');
  assert.match(navigated[1], /^https:\/\/mirror\.example\/\?ext=chrome#u=/);
  assert.equal(
    Buffer.from(navigated[1].split('#u=')[1], 'base64url').toString(),
    'https://news.example/article');
});

test('the shipped address is probed first and used when it answers', async () => {
  local.fronts = { version: 2, hosts: ['mirror.example'] };
  await launch({ tabId: 1, url: 'https://news.example/' });
  assert.deepEqual(fetched, ['https://trickybird.com/api/health'],
    'the walk stops at the first address that answers');
  assert.ok(navigated[1].startsWith('https://trickybird.com/'));
});

// The last candidate is taken without asking: there is nothing to fall back to, so the answer cannot
// change the decision and the round trip would only cost time.
test('the last candidate is never probed', async () => {
  await launch({ tabId: 1, url: 'https://news.example/' });
  assert.deepEqual(fetched, []);
});

// The manifest is what Chrome enforces, so it is what decides. An address it does not name cannot
// answer, and a launch to it must not sit waiting for a reply that can never come.
test('an address the manifest does not name gets the destination instead of a nonce', async () => {
  local.settings = { endpoints: ['https://tb-front.test'], autoRecover: false };
  const result = await launch({ tabId: 1, url: 'https://news.example/' });
  assert.equal(result.endpoint, 'https://tb-front.test');
  assert.equal(result.nonce, undefined);
  assert.match(navigated[1], /#u=/);
});

test('an address already spent is not offered again', async () => {
  local.fronts = { version: 2, hosts: ['mirror.example'] };
  await launch({ tabId: 1, url: 'https://news.example/', tried: ['https://trickybird.com'] });
  assert.ok(navigated[1].startsWith('https://mirror.example/'));
});

// The probe is a fast path, never a gate: a censor who adds latency must not be able to make the
// extension declare a live address dead and stop.
test('when nothing answers the last candidate is used anyway', async () => {
  local.fronts = { version: 2, hosts: ['mirror.example'] };
  unreachable = new Set(['trickybird.com', 'mirror.example']);
  const result = await launch({ tabId: 1, url: 'https://news.example/' });
  assert.equal(result.ok, true);
  assert.ok(navigated[1], 'the tab still went somewhere');
});

test('a launch refuses a page that cannot be routed', async () => {
  await assert.rejects(launch({ tabId: 1, url: 'chrome://settings' }), /TB-104/);
  assert.equal(navigated[1], undefined);
});

test('past the last configured address the tab goes back where it came from', async () => {
  await assert.rejects(
    launch({
      tabId: 1,
      url: 'https://news.example/article',
      originalUrl: 'https://news.example/article',
      tried: ['https://trickybird.com'],
    }),
    /TB-103/);
  assert.equal(navigated[1], 'https://news.example/article');
});

/*
 * The same dead end, reached from our own side: a launch started on a tab that is already fenced
 * sends it to the console, and the fence lets nothing but the gateway through. The browser then
 * blocks our own page and tells the reader an extension did it. Pressing the panel's retry on a
 * routed tab walked straight into this.
 */
test('launching from a fenced tab takes that fence off before sending it to the console', async () => {
  await routeTo(1, 'https://one.example');
  await routeTo(2, 'https://two.example');

  await launch({ tabId: 1, url: 'https://news.example/article' });

  assert.equal(rules.filter((r) => r.condition.tabIds?.[0] === 1).length, 0,
    'the tab went to the console still fenced');
  assert.ok(rules.some((r) => r.condition.tabIds?.[0] === 2), 'tab 2 lost a fence that was not its own');
  assert.ok(navigated[1].startsWith('https://trickybird.com/?ext=chrome'), navigated[1]);
});

test('a launch that runs out of addresses unfences the tab it sends home', async () => {
  await routeTo(1, 'https://one.example');
  await assert.rejects(launch({
    tabId: 1,
    url: 'https://news.example/article',
    originalUrl: 'https://news.example/article',
    tried: ['https://trickybird.com'],
  }), /TB-103/);
  assert.equal(rules.filter((r) => r.condition.tabIds?.[0] === 1).length, 0,
    'the tab was sent home behind its own fence');
  assert.equal(navigated[1], 'https://news.example/article');
});
