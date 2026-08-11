// The mark is inlined into both surfaces because a page cannot fetch one under this CSP. Two
// copies of a brand asset drift, so they are pinned to each other and to a known shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Every mark drawn on a surface. @param {string} html */
const marks = (html) => [...html.matchAll(/<svg class="mark"[\s\S]*?<\/svg>/g)]
  .map((m) => m[0].replace(/\s+/g, ' ').trim());

test('every copy of the mark is the same drawing', () => {
  const all = ['popup', 'options'].flatMap((s) => marks(read(`../src/${s}.html`)));
  assert.ok(all.length >= 2, 'both surfaces should carry the mark');
  assert.equal(new Set(all).size, 1, 'the copies have drifted apart');
});

test('the mark is the one the icons are cut from', () => {
  const [svg] = marks(read('../src/popup.html'));
  assert.match(svg, /viewBox="6\.5 3 22 22"/);
  assert.match(svg, /fill-rule="evenodd"/);
  // The eye is a counter cut out of the body, not a second shape painted over it.
  assert.match(svg, /a1\.65 1\.65 0 110 3\.3a1\.65 1\.65 0 010-3\.3/);
});

test('the mark inside the illustration is that same drawing', () => {
  const html = read('../src/popup.html');
  const [chip] = marks(html);
  const drawn = /<path class="mark-path"[\s\S]*?d="([^"]+)"/.exec(html);
  assert.ok(drawn, 'the routed state draws the mark in the address bar');
  assert.ok(chip.includes(drawn[1]), 'the drawn mark has drifted from the chip');
});

test('it is decoration beside a name, never the only thing announcing the state', () => {
  for (const surface of ['popup', 'options']) {
    for (const svg of marks(read(`../src/${surface}.html`))) {
      assert.match(svg, /aria-hidden="true"/, `${surface}: the mark must not be read out`);
    }
  }
});
