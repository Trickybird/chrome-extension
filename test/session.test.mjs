import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSession, parseSession } from '../src/session.js';
import { ErrorCode, MESSAGE_KEY, RoutingError, toFailure } from '../src/errors.js';

/** @param {Record<string, number|Error>} byHost */
const fakeFetch = (byHost) => {
  /** @type {string[]} */
  const tried = [];
  /** @type {any} */
  const impl = async (/** @type {any} */ url) => {
    const host = new URL(String(url)).host;
    tried.push(host);
    const answer = byHost[host];
    if (answer instanceof Error) throw answer;
    return {
      ok: answer >= 200 && answer < 300,
      status: answer,
      json: async () => ({ proxyUrl: `https://proxy.${host}/_session` }),
    };
  };
  impl.tried = tried;
  return impl;
};

test('a usable response yields the address and the endpoint it names', () => {
  assert.deepEqual(parseSession({ proxyUrl: 'https://proxy.example/_session?x=1' }), {
    bootstrapUrl: 'https://proxy.example/_session?x=1',
    endpoint: 'https://proxy.example',
  });
});

// The endpoint the rules point at comes from the answer, not from configuration, so a malformed
// answer must fail rather than produce rules aimed at nothing.
test('an unusable response yields nothing', () => {
  for (const body of [null, {}, { proxyUrl: '' }, { proxyUrl: 'not a url' },
    { proxyUrl: 'javascript:alert(1)' }, { proxyUrl: 42 }, 'string']) {
    assert.equal(parseSession(body), null, JSON.stringify(body));
  }
});

test('every error code has copy behind it', () => {
  for (const code of Object.values(ErrorCode)) {
    assert.ok(MESSAGE_KEY[code]?.body, `${code} needs a body string`);
    assert.ok(MESSAGE_KEY[code]?.helper, `${code} needs a helper string`);
  }
});

test('codes are unique, since a person reads one out to report a problem', () => {
  const codes = Object.values(ErrorCode);
  assert.equal(new Set(codes).size, codes.length);
});

test('a failure crossing the message boundary is plain data', () => {
  const failure = toFailure(new RoutingError(ErrorCode.TAB_GONE, 'closed'));
  assert.deepEqual(failure, { ok: false, code: ErrorCode.TAB_GONE, detail: 'TB-105: closed' });
  assert.equal(JSON.parse(JSON.stringify(failure)).code, ErrorCode.TAB_GONE);
});

test('an unexpected throw still produces a reportable code', () => {
  assert.equal(toFailure(new TypeError('boom')).code, ErrorCode.NO_SESSION);
});

test('the walk stops at the first address that answers', async () => {
  const fetchImpl = fakeFetch({ 'a.example': 500, 'b.example': 200, 'c.example': 200 });
  const session = await openSession(
    ['https://a.example', 'https://b.example', 'https://c.example'], 'https://target.example/',
    fetchImpl,
  );
  assert.equal(session.via, 'https://b.example');
  assert.equal(session.endpoint, 'https://proxy.b.example');
  assert.deepEqual(fetchImpl.tried, ['a.example', 'b.example']);
});

// Silence and refusal need different copy in the popup, so they carry different codes.
test('addresses that never answer read as unreachable', async () => {
  await assert.rejects(
    openSession(['https://a.example', 'https://b.example'], 'https://target.example/',
      fakeFetch({ 'a.example': new Error('offline'), 'b.example': new Error('offline') })),
    (/** @type {any} */ e) => e.code === ErrorCode.ENDPOINT_UNREACHABLE,
  );
});

test('addresses that answer and refuse read as no session', async () => {
  await assert.rejects(
    openSession(['https://a.example', 'https://b.example'], 'https://target.example/',
      fakeFetch({ 'a.example': 500, 'b.example': 429 })),
    (/** @type {any} */ e) => e.code === ErrorCode.NO_SESSION,
  );
});

test('an empty list fails without touching the network', async () => {
  const fetchImpl = fakeFetch({});
  await assert.rejects(openSession([], 'https://target.example/', fetchImpl));
  assert.deepEqual(fetchImpl.tried, []);
});
