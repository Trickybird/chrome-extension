// The order these branches run in is the whole surface. A launch that failed leaves the tab on our
// own console, and the panel for standing on our own site has no buttons on it: answering that
// question before the failure question is how the popup became a dead end for the one person who
// most needed something to press.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { choose } from '../src/panel.js';
import { targetFragment, ticketFragment } from '../src/fragment.js';

const TARGET = 'https://news.example/article';
const CONSOLE = 'https://trickybird.com/?ext=chrome';
/** @param {string} url @returns {import('../src/panel.js').Offer} */
const error = (url, code = 'TB-101') => ({ url, reason: 'error', code });

test('a failed launch is shown even though it left the tab on our own site', () => {
  const choice = choose({ url: CONSOLE, onOwnConsole: true, offer: error(TARGET) });
  assert.equal(choice.panel, 'failed');
  assert.equal(choice.url, TARGET, 'the retry has to name the address, not the console');
  assert.equal(choice.code, 'TB-101');
});

test('a failed launch keeps its screen anywhere else too', () => {
  const choice = choose({ url: TARGET, onOwnConsole: false, offer: error(TARGET) });
  assert.equal(choice.panel, 'failed');
  assert.equal(choice.url, TARGET);
});

// The right-click entry on a link: the tab was never on that address, so the retry cannot read it
// off the tab.
test('a failure carries its own address rather than the page it was raised on', () => {
  const choice = choose({ url: 'https://forum.example/thread', onOwnConsole: false, offer: error(TARGET) });
  assert.equal(choice.panel, 'failed');
  assert.equal(choice.url, TARGET);
});

test('on our own site with a launch waiting, the panel is the one that can cancel it', () => {
  const choice = choose({ url: CONSOLE, onOwnConsole: true, waitingFrom: TARGET, offer: null });
  assert.deepEqual(choice, { panel: 'handoff', from: TARGET });
});

test('on our own site with nothing recorded, the panel says so', () => {
  assert.deepEqual(choose({ url: CONSOLE, onOwnConsole: true, offer: null }), { panel: 'onSite' });
});

// A launch that failed outranks one that is still waiting: the record that can be acted on wins.
test('a failure outranks a launch still parked for the same tab', () => {
  const choice = choose({ url: CONSOLE, onOwnConsole: true, waitingFrom: TARGET, offer: error(TARGET) });
  assert.equal(choice.panel, 'failed');
});

test('an offer to open something is not a failure', () => {
  const choice = choose({
    url: 'https://news.example/', onOwnConsole: false,
    offer: /** @type {import('../src/panel.js').Offer} */ ({ url: TARGET, reason: 'failed' }),
  });
  assert.equal(choice.panel, 'offer');
  assert.equal(choice.reason, 'failed');
  assert.equal(choice.url, TARGET);
});

test('an ordinary page with nothing recorded gets the offer to route it', () => {
  const choice = choose({ url: TARGET, onOwnConsole: false, offer: null });
  assert.equal(choice.panel, 'idle');
  assert.equal(choice.target.host, 'news.example');
});

test('a page we cannot route falls back to the launcher', () => {
  assert.deepEqual(choose({ url: 'chrome://extensions', onOwnConsole: false, offer: null }),
    { panel: 'launcher' });
});

// A stored record is not a promise: it survives a browser restart and an upgrade, so a shape that
// no longer parses has to fall through rather than take the panel down with it.
test('a failure naming an address we cannot route does not become the failure screen', () => {
  assert.deepEqual(choose({ url: CONSOLE, onOwnConsole: true, offer: error('not-an-address') }),
    { panel: 'onSite' });
});

const TICKET = `${CONSOLE}${ticketFragment('A'.repeat(22))}`;

// What the person is looking at while all of this is decided: an address bar that still says a
// launch is in progress. Answering it with the panel written for someone who walked in on their own
// is what read as a dead end.
test('a ticket we are no longer holding says the launch is over', () => {
  assert.deepEqual(choose({ url: TICKET, onOwnConsole: true, offer: null }), { panel: 'expired' });
});

test('a launch still parked is not an expired one', () => {
  assert.deepEqual(choose({ url: TICKET, onOwnConsole: true, waitingFrom: TARGET, offer: null }),
    { panel: 'handoff', from: TARGET });
});

// The other shape carries its own destination and never had a record here, so having none proves
// nothing about it.
test('an address carried in the fragment is not a launch we lost', () => {
  const url = `${CONSOLE}${targetFragment('aHR0cHM6Ly9uZXdzLmV4YW1wbGUv')}`;
  assert.deepEqual(choose({ url, onOwnConsole: true, offer: null }), { panel: 'onSite' });
});
