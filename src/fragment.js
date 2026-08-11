/**
 * What the console is sent with, and how to read it back. One owner, because three parties know this
 * shape: we write it, the console parses it, and the popup has to tell a launch still in flight from
 * one whose record the extension no longer holds.
 */

/** A nonce is 16 bytes of base64url, which is what `pending.js` issues. */
const TICKET = /#ticket=[A-Za-z0-9_-]{22}$/;

/** @param {string} nonce */
export const ticketFragment = (nonce) => `#ticket=${nonce}`;

/** @param {string} encoded The address, already base64url. */
export const targetFragment = (encoded) => `#u=${encoded}`;

/**
 * Whether this tab was sent here by a launch that expects an answer from us. The other shape carries
 * its own destination and never had a record, so its absence proves nothing.
 * @param {string|undefined} url
 */
export const carriesTicket = (url) => TICKET.test(String(url ?? ''));
