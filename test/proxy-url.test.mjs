import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeOrigin, encodeOrigin, fromProxyUrl, proxyPrefix } from '../src/proxy-url.js';

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/url-vectors.json', import.meta.url), 'utf8'),
);

test('every origin vector encodes to its recorded form', () => {
  assert.ok(vectors.origins.length >= 5);
  for (const { origin, b64 } of vectors.origins) {
    assert.equal(encodeOrigin(origin), b64, origin);
  }
});

test('encoding is base64url without padding', () => {
  for (const { b64 } of vectors.origins) {
    assert.doesNotMatch(b64, /[+/=]/, b64);
  }
});

test('decoding reverses encoding for every vector', () => {
  for (const { origin, b64 } of vectors.origins) {
    assert.equal(decodeOrigin(b64), origin, origin);
  }
});

test('the prefix a redirect substitutes into carries the encoded origin', () => {
  const b64 = encodeOrigin('https://example.com');
  assert.equal(proxyPrefix('https://proxy.example', 'https://example.com'), `https://proxy.example/_o/${b64}/`);
});

test('a trailing slash on the endpoint does not double up', () => {
  assert.equal(
    proxyPrefix('https://proxy.example/', 'https://example.com'),
    proxyPrefix('https://proxy.example', 'https://example.com'),
  );
});

test('a proxied address reads back to its parts', () => {
  const url = `${proxyPrefix('https://proxy.example', 'https://example.com')}a/b?x=1`;
  assert.deepEqual(fromProxyUrl(url), {
    endpoint: 'https://proxy.example', origin: 'https://example.com', path: '/a/b',
  });
});

test('an ordinary address does not read back as proxied', () => {
  assert.equal(fromProxyUrl('https://example.com/a'), null);
  assert.equal(fromProxyUrl('not a url'), null);
});
