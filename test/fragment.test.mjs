// The console is handed one of two shapes and the popup reads them back. Three parties know this
// format, so what the extension writes has to be what the extension recognises.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { carriesTicket, targetFragment, ticketFragment } from '../src/fragment.js';

const NONCE = 'A'.repeat(22);

test('a ticket the extension writes is one it reads back', () => {
  assert.equal(carriesTicket(`https://trickybird.com/?ext=chrome${ticketFragment(NONCE)}`), true);
});

test('an address carried in the fragment is not a ticket', () => {
  assert.equal(carriesTicket(`https://trickybird.com/${targetFragment('aHR0cHM6Ly9h')}`), false);
});

test('nothing that only looks like one counts', () => {
  for (const url of ['https://trickybird.com/', 'https://trickybird.com/#ticket=', undefined,
    'https://trickybird.com/#ticket=tooshort', `https://trickybird.com/#ticket=${'A'.repeat(23)}`]) {
    assert.equal(carriesTicket(url), false, String(url));
  }
});
