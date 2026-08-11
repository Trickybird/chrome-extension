import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOfferable } from '../src/recovery.js';

const failure = (over = {}) => ({
  error: 'net::ERR_NAME_NOT_RESOLVED', frameId: 0, url: 'https://example.com/', ...over,
});

test('a page that could not be resolved is worth offering', () => {
  assert.equal(isOfferable(failure()), true);
});

// Chrome reports this whenever a navigation is replaced or the user leaves, so acting on it would
// put a mark on the icon during ordinary browsing.
test('an aborted navigation is never offered', () => {
  assert.equal(isOfferable(failure({ error: 'net::ERR_ABORTED' })), false);
});

test('a block set on the device is never offered, because routing cannot lift it', () => {
  for (const error of ['net::ERR_BLOCKED_BY_ADMINISTRATOR', 'net::ERR_BLOCKED_BY_CLIENT',
    'net::ERR_UNSAFE_PORT']) {
    assert.equal(isOfferable(failure({ error })), false, error);
  }
});

test('an unknown error is not offered', () => {
  assert.equal(isOfferable(failure({ error: 'net::ERR_SOMETHING_NEW' })), false);
  assert.equal(isOfferable(failure({ error: undefined })), false);
});

test('only the top-level page counts, never a frame inside it', () => {
  assert.equal(isOfferable(failure({ frameId: 1 })), false);
  assert.equal(isOfferable(failure({ frameId: undefined })), false);
});

test('a page we could not route anyway is not offered', () => {
  assert.equal(isOfferable(failure({ url: 'chrome://extensions' })), false);
  assert.equal(isOfferable(failure({ url: 'file:///tmp/x.html' })), false);
  assert.equal(isOfferable(failure({ url: undefined })), false);
});
