/**
 * Which failed navigation is worth an offer, and which offer a later page takes with it. The list is
 * closed on purpose: Chrome reports ERR_ABORTED whenever a page is left, and a policy block is not
 * something we can undo.
 */

const OFFERABLE = new Set([
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_FAILED',
  'net::ERR_ADDRESS_UNREACHABLE',
  'net::ERR_EMPTY_RESPONSE',
  'net::ERR_TIMED_OUT',
  'net::ERR_SSL_PROTOCOL_ERROR',
]);

/** An address the console could do something with. @param {string|undefined} url */
const isWebAddress = (url) => {
  try {
    return /^https?:$/.test(new URL(url ?? '').protocol);
  } catch {
    return false;
  }
};

/** @param {{ error?: string, frameId?: number, url?: string }} details */
export function isOfferable({ error, frameId, url }) {
  return frameId === 0 && OFFERABLE.has(error ?? '') && isWebAddress(url);
}

/**
 * The fence's own refusal, told apart from every other reason a navigation fails. It is on the
 * closed list above and stays there: an offer would put the address behind a second press, and this
 * one deserves an answer of its own, because Chrome's page for it names an extension as the culprit
 * and tells the reader to switch extensions off.
 *
 * Chrome reports the same code for any extension's block, so being sure it was ours is the caller's
 * job: only a tab we fenced is acted on. The shape is all that is read here.
 *
 * @param {{ error?: string, frameId?: number, url?: string }} details
 */
export function isOurOwnBlock({ error, frameId, url }) {
  return frameId === 0 && error === 'net::ERR_BLOCKED_BY_CLIENT' && isWebAddress(url);
}

/**
 * Whether a page finishing its load takes the tab's offer with it. One raised by a failed navigation
 * is answered by the next load that works. Our own failure is not about the page in the tab at all:
 * it carries the address someone asked for, and while the tab is still parked on the console that
 * failed it is the only copy left, the reload they reach for first included.
 *
 * @param {{ reason?: string }|null} offer @param {boolean} onOwnConsole
 */
export const clearedByLoad = (offer, onOwnConsole) => !(offer?.reason === 'error' && onOwnConsole);
