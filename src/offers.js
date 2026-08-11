/**
 * A pending suggestion for one tab. The right-click entry and a failed navigation both produce one;
 * the popup is the only thing that acts on it.
 */

import { setBadge } from './badge.js';

/** @typedef {{ url: string, reason: 'link'|'failed'|'error', code?: string }} Offer */

const KEY = 'offers';

/** @returns {Promise<Record<string, Offer>>} */
const all = async () => /** @type {Record<string, Offer>} */ (
  (await chrome.storage.session.get(KEY))[KEY] ?? {});

/** @param {number} tabId @param {string} url @param {Offer['reason']} reason @param {string} [code] */
export async function put(tabId, url, reason, code) {
  // Only carry a code when there is one, so a stored offer never has a key holding undefined.
  const offer = code ? { url, reason, code } : { url, reason };
  await chrome.storage.session.set({ [KEY]: { ...(await all()), [String(tabId)]: offer } });
  await setBadge(tabId, 'attention');
}

/** @param {number} tabId @returns {Promise<Offer|null>} */
export async function get(tabId) {
  return (await all())[String(tabId)] ?? null;
}

/** @param {number} tabId */
export async function drop(tabId) {
  const rest = await all();
  if (rest[String(tabId)]) {
    delete rest[String(tabId)];
    await chrome.storage.session.set({ [KEY]: rest });
  }
  await setBadge(tabId, 'none');
}
