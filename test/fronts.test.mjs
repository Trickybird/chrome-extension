// Where the addresses come from, and what happens when the answer is a lie, a silence, or yesterday.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const local = /** @type {Record<string, any>} */ ({});
/** @type {string[]} */
let requested = [];
/** What each URL should do: a body, or the word `dead`. */
let answers = /** @type {Record<string, any>} */ ({});

const clear = (/** @type {Record<string, any>} */ bag) => {
  for (const key of Object.keys(bag)) delete bag[key];
};

/** @type {any} */ (globalThis).chrome = {
  storage: {
    local: {
      get: async (/** @type {string} */ key) => ({ [key]: local[key] }),
      set: async (/** @type {any} */ patch) => { Object.assign(local, patch); },
    },
  },
};

globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url) => {
  requested.push(String(url));
  const hit = Object.entries(answers).find(([k]) => String(url).includes(k));
  if (!hit || hit[1] === 'dead') throw new TypeError('Failed to fetch');
  return { ok: true, status: 200, json: async () => hit[1] };
});

const { subtle } = webcrypto;
const CURVE = { name: 'ECDSA', namedCurve: 'P-256' };
const b64url = (/** @type {ArrayBuffer} */ b) => Buffer.from(b).toString('base64url');
const pair = await subtle.generateKey(CURVE, true, ['sign', 'verify']);
const PUBLIC = b64url(await subtle.exportKey('raw', pair.publicKey));

const { CATALOG } = await import('../src/config.js');
// The shipped key signs the shipped record; this suite needs one it can re-sign at will.
CATALOG.publicKey = PUBLIC;

const { firstReachable, frontEndpoints, isOurOwnConsole, refreshCatalog, storedCatalog } =
  await import('../src/fronts.js');

async function record(/** @type {number} */ version, /** @type {string[]} */ hosts) {
  const signed = new TextEncoder().encode(`tb-fronts-v1|${version}|${hosts.join(',')}`);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed);
  return `tb1 ${version} ${hosts.join(',')} ${b64url(sig)}`;
}

const asTxt = (/** @type {string} */ text) => ({ Status: 0, Answer: [{ type: 16, data: `"${text}"` }] });

beforeEach(() => {
  clear(local);
  requested = [];
  answers = {};
});

test('a signed record is taken and stored', async () => {
  answers['cloudflare-dns.com'] = asTxt(await record(2, ['a.example', 'b.example']));
  assert.equal(await refreshCatalog(), true);
  assert.deepEqual(await storedCatalog(), { version: 2, hosts: ['a.example', 'b.example'] });
});

test('the shipped address leads and the record follows', async () => {
  answers['cloudflare-dns.com'] = asTxt(await record(2, ['a.example']));
  await refreshCatalog();
  assert.deepEqual(await frontEndpoints(), ['https://trickybird.com', 'https://a.example']);
});

// The whole point of the signature: a resolver that answers with addresses of its own.
test('a record we did not sign changes nothing', async () => {
  local.fronts = { version: 2, hosts: ['ours.example'] };
  answers['cloudflare-dns.com'] = asTxt('tb1 9 evil.example ' + 'A'.repeat(86));
  assert.equal(await refreshCatalog(), false);
  assert.deepEqual((await storedCatalog())?.hosts, ['ours.example']);
});

test('a real record from before what we hold is refused', async () => {
  local.fronts = { version: 5, hosts: ['current.example'] };
  answers['cloudflare-dns.com'] = asTxt(await record(3, ['blocked.example']));
  assert.equal(await refreshCatalog(), false);
  assert.deepEqual((await storedCatalog())?.hosts, ['current.example']);
});

test('silence leaves what worked last time exactly as it was', async () => {
  local.fronts = { version: 4, hosts: ['known.example'] };
  answers = {};
  assert.equal(await refreshCatalog(), false);
  assert.deepEqual((await storedCatalog())?.hosts, ['known.example']);
});

// One resolver will eventually be the one that is blocked, and it must not take the list with it.
test('the second resolver is asked when the first is blocked', async () => {
  answers['dns.google'] = asTxt(await record(2, ['a.example']));
  assert.equal(await refreshCatalog(), true);
  assert.equal(requested.length, 2, 'the first was tried and failed before the second');
  assert.match(requested[0], /cloudflare-dns\.com/);
});

test('a TXT record split into fragments is joined before it is read', async () => {
  const text = await record(2, ['a.example', 'b.example']);
  const half = Math.floor(text.length / 2);
  answers['cloudflare-dns.com'] = {
    Status: 0,
    Answer: [{ type: 16, data: `"${text.slice(0, half)}" "${text.slice(half)}"` }],
  };
  assert.equal(await refreshCatalog(), true);
  assert.deepEqual((await storedCatalog())?.hosts, ['a.example', 'b.example']);
});

test('a name that does not exist is not an answer', async () => {
  answers['cloudflare-dns.com'] = { Status: 3, Answer: [] };
  answers['dns.google'] = { Status: 3, Answer: [] };
  assert.equal(await refreshCatalog(), false);
});

// The probe decides where to start, never whether to go: a censor who only adds latency must not be
// able to make the extension give up on an address that works.
test('the first address that answers is used', async () => {
  answers['b.example/api/health'] = { ok: true };
  const chosen = await firstReachable(['https://a.example', 'https://b.example', 'https://c.example']);
  assert.equal(chosen, 'https://b.example');
});

test('when nothing answers the last candidate is used anyway', async () => {
  const chosen = await firstReachable(['https://a.example', 'https://b.example']);
  assert.equal(chosen, 'https://b.example');
});

test('the last candidate is taken without a probe, because the answer cannot change it', async () => {
  await firstReachable(['https://only.example']);
  assert.deepEqual(requested, []);
});

test('the probe asks one address at a time, never all of them at once', async () => {
  answers['c.example/api/health'] = { ok: true };
  await firstReachable(['https://a.example', 'https://b.example', 'https://c.example']);
  assert.deepEqual(requested.map((u) => new URL(u).hostname), ['a.example', 'b.example']);
});

// Standing on our own console, mid-launch. Offering to open it through ourselves is a dead end and
// nonsense besides, so the popup has to be able to tell.
for (const [label, url, want] of /** @type {[string, string|undefined, boolean][]} */ ([
  ['the console itself', 'https://a.example/', true],
  ['a page on the console', 'https://a.example/?ext=chrome#ticket=x', true],
  ['a mirror from the record', 'https://b.example/', true],
  ['an ordinary site', 'https://news.example/article', false],
  ['a lookalike', 'https://a.example.evil.test/', false],
  ['a browser page', 'chrome://extensions', false],
  ['nothing at all', undefined, false],
])) {
  test(`${label} is ${want ? '' : 'not '}one of ours`, () => {
    assert.equal(isOurOwnConsole(url, ['https://a.example', 'https://b.example']), want);
  });
}
