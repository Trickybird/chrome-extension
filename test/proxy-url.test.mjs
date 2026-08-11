import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromProxyUrl } from '../src/proxy-url.js';

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/url-vectors.json', import.meta.url), 'utf8'),
);
const proxied = (/** @type {string} */ b64, tail = '/a/b?x=1') => `https://proxy.example/_o/${b64}${tail}`;

test('every origin vector reads back out of a proxied address', () => {
  assert.ok(vectors.origins.length >= 5);
  for (const { origin, b64 } of vectors.origins) {
    assert.equal(fromProxyUrl(proxied(b64))?.origin, origin, origin);
  }
});

test('the recorded encoding is base64url without padding', () => {
  for (const { b64 } of vectors.origins) {
    assert.doesNotMatch(b64, /[+/=]/, b64);
  }
});

test('a proxied address reads back to its parts', () => {
  assert.deepEqual(fromProxyUrl(proxied('aHR0cHM6Ly9leGFtcGxlLmNvbQ')), {
    endpoint: 'https://proxy.example', origin: 'https://example.com', path: '/a/b',
  });
});

test('an ordinary address does not read back as proxied', () => {
  assert.equal(fromProxyUrl('https://example.com/a'), null);
  assert.equal(fromProxyUrl('not a url'), null);
});

// The page owns its own address bar. Anything it pushes under /_o/ arrives here, and an "origin"
// that decodes but does not parse used to be handed on to whoever drew it next.
test('a segment that is not a web address does not read back as proxied', () => {
  for (const junk of [
    'Zm9vYmFy',                    // foobar
    'aHR0cDovLw',                  // http://
    'Li4v',                        // ../
    'amF2YXNjcmlwdDphbGVydCgxKQ',  // javascript:alert(1)
    'ZGF0YTp0ZXh0L2h0bWwsPHNjcmlwdD4x',  // data:text/html,<script>1
    'not+base64',
    '',
  ]) {
    assert.equal(fromProxyUrl(proxied(junk, '/x')), null, junk);
  }
});
