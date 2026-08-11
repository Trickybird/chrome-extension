/**
 * Which panel the popup shows. Pure, and kept apart from the drawing: every dead end this surface
 * has had was a question of order rather than of markup, and order is the one thing a DOM test is
 * bad at pinning. A tab already carrying a fence is decided before this and never reaches here.
 */

import { classify } from './target.js';
import { carriesTicket } from './fragment.js';

/** @typedef {{ ok: true, origin: string, host: string }} Routable */
/** @typedef {{ url: string, reason: 'link'|'failed'|'error', code?: string }} Offer */
/**
 * @typedef {{ panel: 'onSite'|'launcher'|'expired' }} Bare
 * @typedef {{ panel: 'handoff', from: string }} Waiting
 * @typedef {{ panel: 'failed', target: Routable, url: string, code?: string }} Failed
 * @typedef {{ panel: 'offer', target: Routable, url: string, reason: Offer['reason'] }} Offered
 * @typedef {{ panel: 'idle', target: Routable }} Idle
 */

/**
 * @param {{ url?: string, onOwnConsole: boolean, waitingFrom?: string, offer: Offer|null }} input
 * @returns {Bare|Waiting|Failed|Offered|Idle}
 */
export function choose({ url, onOwnConsole, waitingFrom, offer }) {
  // A failure we recorded outranks where the tab is standing, and this is the whole repair: a launch
  // that fails leaves the tab on our own console, the branch below answered that with a panel
  // holding no buttons, and the address the person asked for lives nowhere else by then.
  const failed = offer?.reason === 'error' ? classify(offer.url) : null;
  if (offer && failed?.ok) {
    return { panel: 'failed', target: failed, url: offer.url, code: offer.code };
  }

  // Standing on our own site. Offering to open it through ourselves reads as a dead end and is
  // nonsense besides, so the only thing left to say is which way in the page itself offers.
  if (onOwnConsole) {
    if (waitingFrom) return { panel: 'handoff', from: waitingFrom };
    // Sent here by a launch, and we are holding nothing for it: the record ran out, or the browser
    // dropped what the extension kept in memory. Answering that with the panel for someone who
    // walked in on their own is what read as a dead end, because the address bar still says a
    // launch is in progress.
    return carriesTicket(url) ? { panel: 'expired' } : { panel: 'onSite' };
  }

  const target = classify(offer?.url ?? url);
  if (!target.ok) return { panel: 'launcher' };
  return offer
    ? { panel: 'offer', target, url: offer.url, reason: offer.reason }
    : { panel: 'idle', target };
}
