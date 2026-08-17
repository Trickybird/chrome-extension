/**
 * A pending suggestion for one tab. The right-click entry and a failed navigation both produce one;
 * the popup is the only thing that acts on it.
 */

import { setBadge } from './badge.js';
import { sessionMap } from './session-map.js';

/** @typedef {{ url: string, reason: 'failed'|'error', code?: string }} Offer */

const store = /** @type {import('./session-map.js').SessionMap<Offer>} */ (sessionMap('offers'));

/** @param {number} tabId @param {string} url @param {Offer['reason']} reason @param {string} [code] */
export async function put(tabId, url, reason, code) {
  // Only carry a code when there is one, so a stored offer never has a key holding undefined.
  const offer = code ? { url, reason, code } : { url, reason };
  await store.update((records) => [{ ...records, [String(tabId)]: offer }, null]);
  await setBadge(tabId, 'attention');
}

/** @param {number} tabId @returns {Promise<Offer|null>} */
export async function get(tabId) {
  return (await store.read())[String(tabId)] ?? null;
}

/** @param {number} tabId */
export async function drop(tabId) {
  await store.update((records) => {
    if (!records[String(tabId)]) return [records, null];
    const { [String(tabId)]: gone, ...rest } = records;
    return [rest, null];
  });
  await setBadge(tabId, 'none');
}
