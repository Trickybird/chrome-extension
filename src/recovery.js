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

/** @param {{ error?: string, frameId?: number, url?: string }} details */
export function isOfferable({ error, frameId, url }) {
  if (frameId !== 0 || !OFFERABLE.has(error ?? '')) return false;
  try {
    return /^https?:$/.test(new URL(url ?? '').protocol);
  } catch {
    return false;
  }
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
