import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearedByLoad, isOfferable, isOurOwnBlock } from '../src/recovery.js';

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

// The reload is what someone reaches for while stuck, and it used to be the thing that removed the
// only record of what they had asked for.
test('our own failure survives a reload of the console it is parked on', () => {
  assert.equal(clearedByLoad({ reason: 'error' }, true), false);
});

test('our own failure is stale once the tab is somewhere else', () => {
  assert.equal(clearedByLoad({ reason: 'error' }, false), true);
});

/*
 * The caller used to work out half of this rule and pass the answer in under a name that described
 * only one of its two halves, so `reason === 'error'` was tested in two modules at once. Whether an
 * offer survives a load is this module's question; where the tab is standing is the caller's.
 */
test('an offer that is not ours to keep is cleared wherever the tab is standing', () => {
  assert.equal(clearedByLoad({ reason: 'failed' }, true), true);
  assert.equal(clearedByLoad({ reason: 'failed' }, false), true);
});

test('an offer a failed navigation raised is answered by a page that loads', () => {
  assert.equal(clearedByLoad({ reason: 'failed' }, false), true);
  assert.equal(clearedByLoad(null, true), true);
});

/*
 * Our own fence is the one block on that list we can undo, and the only one where Chrome's page is
 * worse than useless: it names an extension as the culprit and tells the reader to switch extensions
 * off. It stays out of the offers and gets an answer of its own instead.
 */
test('the block the fence itself raised is recognised, and nothing else is taken for it', () => {
  assert.equal(isOurOwnBlock(failure({ error: 'net::ERR_BLOCKED_BY_CLIENT' })), true);
  for (const error of ['net::ERR_BLOCKED_BY_ADMINISTRATOR', 'net::ERR_NAME_NOT_RESOLVED',
    'net::ERR_ABORTED']) {
    assert.equal(isOurOwnBlock(failure({ error })), false, error);
  }
});

test('a blocked subframe is not a person leaving, so it is left alone', () => {
  assert.equal(isOurOwnBlock(failure({ error: 'net::ERR_BLOCKED_BY_CLIENT', frameId: 7 })), false);
});

test('a blocked address the console could not open anyway is left alone', () => {
  assert.equal(
    isOurOwnBlock(failure({ error: 'net::ERR_BLOCKED_BY_CLIENT', url: 'chrome://settings' })),
    false);
});
