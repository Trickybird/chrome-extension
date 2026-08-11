import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, order } from '../src/endpoints.js';

test('only https addresses survive, in the order given', () => {
  assert.deepEqual(
    normalize(['  https://a.example/  ', 'http://b.example', 'not a url', '', 'https://c.example']),
    ['https://a.example', 'https://c.example'],
  );
});

// The same address twice would be dialled twice on the way down the list.
test('a repeat is dropped, including one that differed only by a trailing slash', () => {
  assert.deepEqual(
    normalize(['https://a.example', 'https://a.example/', 'https://a.example///']),
    ['https://a.example'],
  );
});

test('an address may carry a path', () => {
  assert.deepEqual(normalize(['https://a.example/edge']), ['https://a.example/edge']);
});

test('the one that answered last is tried first', () => {
  const list = ['https://a.example', 'https://b.example', 'https://c.example'];
  assert.deepEqual(order(list, 'https://c.example'), [
    'https://c.example', 'https://a.example', 'https://b.example',
  ]);
});

test('with nothing remembered the configured order stands', () => {
  const list = ['https://a.example', 'https://b.example'];
  assert.deepEqual(order(list, null), list);
  assert.deepEqual(order(list, 'https://gone.example'), list);
});

test('ordering does not mutate the list it was handed', () => {
  const list = ['https://a.example', 'https://b.example'];
  order(list, 'https://b.example');
  assert.deepEqual(list, ['https://a.example', 'https://b.example']);
});
