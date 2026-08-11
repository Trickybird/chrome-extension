// A page script that reaches for an element the markup does not have throws on the first write and
// takes the rest of the page down with it, which reads to a user as a blank screen and an
// unlabelled button. That shipped once. This is the guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Ids the script asks the DOM for. @param {string} js */
const requestedIds = (js) => [
  ...js.matchAll(/(?:el|getElementById)\(\s*'([A-Za-z0-9_-]+)'\s*\)/g),
].map((m) => m[1]);

/** Ids the markup actually defines. @param {string} html */
const definedIds = (html) => new Set(
  [...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]),
);

// Shared modules count as part of both surfaces: an id site-links.js reaches for has to exist in
// each page that loads it, not just in whichever one was checked last.
const SHARED = ['site-links.js'];

for (const surface of ['popup', 'options']) {
  const scripts = () => [`${surface}.js`, ...SHARED].map((f) => read(`../src/${f}`)).join('\n');

  test(`${surface}: every element the script reaches for exists in the markup`, () => {
    const wanted = requestedIds(scripts());
    const have = definedIds(read(`../src/${surface}.html`));
    const missing = [...new Set(wanted)].filter((id) => !have.has(id));
    assert.deepEqual(missing, [], `${surface} reaches for ids ${surface}.html does not define`);
  });

  test(`${surface}: every string it looks up exists in the catalog`, () => {
    const js = scripts();
    const catalog = JSON.parse(read('../_locales/en/messages.json'));
    const keys = [...js.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
    const mapped = [...js.matchAll(/:\s*'(options[A-Za-z0-9_]+|popup[A-Za-z0-9_]+|err[A-Za-z0-9_]+|footer[A-Za-z0-9_]+)'/g)]
      .map((m) => m[1]);
    const missing = [...new Set([...keys, ...mapped])].filter((k) => !catalog[k]);
    assert.deepEqual(missing, [], `${surface} looks up strings the catalog does not have`);
  });
}

test('the markup loads only local styles and scripts', () => {
  for (const surface of ['popup', 'options']) {
    const html = read(`../src/${surface}.html`);
    assert.equal(/(src|href)="(https?:)?\/\//.test(html), false, `${surface}.html loads something remote`);
    assert.equal(/ on[a-z]+=/.test(html), false, `${surface}.html has an inline handler`);
  }
});
