// site-links.js writes into elements by id across two documents. An id it shares with something
// that is not a link gets its contents replaced: `status` once collided with the popup's route
// container, and filling it wiped the whole drawing and left the word "Status" in its place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const source = read('../src/site-links.js');

/** The ids the module reaches for. */
const wanted = [...source.matchAll(/id:\s*'([A-Za-z0-9_-]+)'/g)].map((m) => m[1]);

test('it reaches for at least the links both surfaces carry', () => {
  for (const id of ['support', 'terms', 'privacy']) assert.ok(wanted.includes(id), id);
});

test('every element it fills is an anchor, on every surface that has one', () => {
  for (const surface of ['popup', 'options']) {
    const html = read(`../src/${surface}.html`);
    for (const id of wanted) {
      const tag = new RegExp(`<(\\w+)[^>]*\\sid="${id}"`).exec(html)?.[1];
      if (!tag) continue; // not on this surface, which is allowed
      assert.equal(tag, 'a', `${surface}.html: #${id} is a <${tag}>, and would be overwritten`);
    }
  }
});

test('its paths are all on our own site and none is absolute', () => {
  const paths = [...source.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.length >= 3);
  for (const path of paths) assert.match(path, /^\/[a-z-]+$/, path);
});
