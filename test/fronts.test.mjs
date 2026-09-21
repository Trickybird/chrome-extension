// Where the addresses come from, and what happens when the answer is a lie, a silence, or yesterday.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const local = /** @type {Record<string, any>} */ ({});
/** @type {string[]} */
let requested = [];
/** What each URL should do: a body, or the word `dead`. */
let answers = /** @type {Record<string, any>} */ ({});
/** Stands in for the process dying between the revocation write and the list being dropped. */
let removeThrows = false;

const clear = (/** @type {Record<string, any>} */ bag) => {
  for (const key of Object.keys(bag)) delete bag[key];
};

/** @type {any} */ (globalThis).chrome = {
  storage: {
    local: {
      get: async (/** @type {string} */ key) => ({ [key]: local[key] }),
      set: async (/** @type {any} */ patch) => { Object.assign(local, patch); },
      remove: async (/** @type {string} */ key) => {
        if (removeThrows) throw new Error('storage died mid-write');
        delete local[key];
      },
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
// The shipped list is empty on purpose: the names live outside git and `tools/package.mjs` stamps
// them into the archive. So the suite names its own anchor rather than leaning on a literal that is
// no longer there.
CATALOG.records = ['_fronts.anchor.example'];

const {
  catalogRevoked,
  firstReachable,
  frontEndpoints,
  isOurOwnConsole,
  refreshCatalog,
  storedCatalog,
} = await import('../src/fronts.js');

async function record(/** @type {number} */ version, /** @type {string[]} */ hosts) {
  const signed = new TextEncoder().encode(`tb-fronts-v1|${version}|${hosts.join(',')}`);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed);
  return `tb1 ${version} ${hosts.join(',')} ${b64url(sig)}`;
}

async function revocation() {
  const signed = new TextEncoder().encode(`tb-fronts-revoke-v1|${PUBLIC}`);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed);
  return `tbrev1 ${b64url(sig)}`;
}

const asTxt = (/** @type {string} */ text) => ({ Status: 0, Answer: [{ type: 16, data: `"${text}"` }] });

// DNS splits a TXT record at 255 bytes and the two resolvers we ask hand the pieces back
// differently: one quotes each piece, the other returns them already joined and bare. `asTxt` above
// quotes a whole record as one piece, so neither real shape was ever exercised.
const pieces = (/** @type {string} */ text) => text.match(/.{1,255}/gs) ?? [text];
const asQuotedPieces = (/** @type {string} */ text) =>
  ({ Status: 0, Answer: [{ type: 16, data: pieces(text).map((p) => `"${p}"`).join(' ') }] });
const asBareString = (/** @type {string} */ text) => ({ Status: 0, Answer: [{ type: 16, data: text }] });

/** Sixteen hosts put the record past 255 bytes, which is what makes a resolver split it at all. */
const MANY = Array.from({ length: 16 }, (_, i) => `h${String(i).padStart(2, '0')}.example`);

beforeEach(() => {
  clear(local);
  requested = [];
  answers = {};
  removeThrows = false;
});

test('a signed record is taken and stored', async () => {
  answers['cloudflare-dns.com'] = asTxt(await record(2, ['a.example', 'b.example']));
  assert.equal(await refreshCatalog(), true);
  assert.deepEqual(await storedCatalog(), { version: 2, hosts: ['a.example', 'b.example'] });
});

test('a build that never reached a resolver walks on the seed it shipped with', async () => {
  // No record, so the walk is one address unless the build shipped a seed.
  const { SEED_MIRRORS } = await import('../src/config.js');
  SEED_MIRRORS.push('seed.example');
  try {
    assert.deepEqual(await frontEndpoints(), ['https://trickybird.com', 'https://seed.example']);

    // And a signed list replaces it, so a burned seed costs one release.
    answers['cloudflare-dns.com'] = asTxt(await record(2, ['a.example']));
    await refreshCatalog();
    assert.deepEqual(await frontEndpoints(), ['https://trickybird.com', 'https://a.example']);
  } finally {
    SEED_MIRRORS.length = 0;
  }
});

test('the shipped address leads and the record follows', async () => {
  answers['cloudflare-dns.com'] = asTxt(await record(2, ['a.example']));
  await refreshCatalog();
  assert.deepEqual(await frontEndpoints(), ['https://trickybird.com', 'https://a.example']);
});

test('a record DNS split arrives whole from a resolver that quotes each piece', async () => {
  const long = await record(2, MANY);
  assert.ok(long.length > 255, `needs to exceed one TXT string to split at all, got ${long.length}`);
  assert.ok(pieces(long).length > 1);
  answers['cloudflare-dns.com'] = asQuotedPieces(long);
  assert.equal(await refreshCatalog(), true);
  assert.deepEqual(await storedCatalog(), { version: 2, hosts: MANY });
});

test('the same record arrives whole from a resolver that hands back one bare string', async () => {
  const long = await record(2, MANY);
  answers['cloudflare-dns.com'] = asBareString(long);
  assert.equal(await refreshCatalog(), true);
  assert.deepEqual(await storedCatalog(), { version: 2, hosts: MANY });
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

// One anchor lives on the brand domain, and losing that domain is the failure the catalogue exists
// to survive. An anchor that answers nothing must not end the round.
test('the second anchor is asked when the first answers nothing', async () => {
  const anchors = CATALOG.records;
  CATALOG.records = ['_fronts.first.example', '_fronts.second.example'];
  try {
    answers['_fronts.second.example'] = asTxt(await record(2, ['a.example']));
    assert.equal(await refreshCatalog(), true);
    assert.deepEqual(await storedCatalog(), { version: 2, hosts: ['a.example'] });
    assert.ok(
      requested.some((u) => u.includes('_fronts.first.example')),
      'the first anchor was tried before the second'
    );
  } finally {
    CATALOG.records = anchors;
  }
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

// The kill switch. It is the only thing that answers a compromised signing key, so what it does has
// to be exact: it is read before the catalog, it is terminal, and the client stops asking afterwards.
test('a signed revocation takes the key out of trust and drops the list', async () => {
  local.fronts = { version: 5, hosts: ['old.example'] };
  answers['cloudflare-dns.com'] = asTxt(await revocation());

  assert.equal(await refreshCatalog(), true);
  assert.equal(await catalogRevoked(), true);
  assert.equal(await storedCatalog(), null, 'the list must not survive the revocation');
});

test('a revoked client walks only the addresses its own build ships with', async () => {
  local.fronts = { version: 5, hosts: ['old.example'] };
  answers['cloudflare-dns.com'] = asTxt(await revocation());
  await refreshCatalog();

  assert.deepEqual(await frontEndpoints(), ['https://trickybird.com']);
});

// A list that came back into storage must not come back into use. The removal is hygiene; the check
// on read is the mechanism.
test('a list planted after the revocation is still ignored', async () => {
  answers['cloudflare-dns.com'] = asTxt(await revocation());
  await refreshCatalog();
  local.fronts = { version: 9, hosts: ['planted.example'] };

  assert.deepEqual(await frontEndpoints(), ['https://trickybird.com']);
});

test('a revoked client stops asking, so the kill switch takes the lookup with it', async () => {
  answers['cloudflare-dns.com'] = asTxt(await revocation());
  await refreshCatalog();
  requested = [];

  assert.equal(await refreshCatalog(), false);
  assert.deepEqual(requested, [], 'a revoked client has nothing to learn and must not ask');
});

test('a round carrying both a revocation and a record stores no record', async () => {
  const text = await record(9, ['new.example']);
  answers['cloudflare-dns.com'] = {
    Status: 0,
    Answer: [
      { type: 16, data: `"${text}"` },
      { type: 16, data: `"${await revocation()}"` },
    ],
  };

  assert.equal(await refreshCatalog(), true);
  assert.equal(await catalogRevoked(), true);
  assert.equal(await storedCatalog(), null);
});

test('a revocation we did not sign changes nothing', async () => {
  const other = await subtle.generateKey(CURVE, true, ['sign', 'verify']);
  const signed = new TextEncoder().encode(`tb-fronts-revoke-v1|${PUBLIC}`);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, other.privateKey, signed);
  local.fronts = { version: 2, hosts: ['ours.example'] };
  answers['cloudflare-dns.com'] = asTxt(`tbrev1 ${b64url(sig)}`);

  assert.equal(await refreshCatalog(), false);
  assert.equal(await catalogRevoked(), false);
  assert.deepEqual(await storedCatalog(), { version: 2, hosts: ['ours.example'] });
});

// Storage is state, and a forged string in it must read as no revocation rather than as one.
test('a planted revocation string is not a revocation', async () => {
  local['fronts-revoked'] = `tbrev1 ${'A'.repeat(86)}`;
  assert.equal(await catalogRevoked(), false);

  answers['cloudflare-dns.com'] = asTxt(await record(3, ['a.example']));
  assert.equal(await refreshCatalog(), true, 'a forged revocation must not stop a real refresh');
});

// The order of the two writes, which only matters when something dies between them. Dropping the
// list first and recording the revocation second leaves a client with no list and its trust in the
// key intact, so the next wake-up learns the attacker's list all over again. Nothing else in this
// suite can see that, because in a run that completes both orders look the same.
test('a death between the two writes still leaves the key out of trust', async () => {
  local.fronts = { version: 5, hosts: ['old.example'] };
  answers['cloudflare-dns.com'] = asTxt(await revocation());
  removeThrows = true;

  await assert.rejects(() => refreshCatalog(), /storage died mid-write/);
  assert.equal(await catalogRevoked(), true, 'the revocation must be recorded before the list goes');

  // And the next wake-up must not re-learn a list, which is the whole cost of the wrong order.
  removeThrows = false;
  answers['cloudflare-dns.com'] = asTxt(await record(9, ['attacker.example']));
  requested = [];
  assert.equal(await refreshCatalog(), false);
  assert.deepEqual(requested, []);
  assert.deepEqual(await frontEndpoints(), ['https://trickybird.com']);
});
