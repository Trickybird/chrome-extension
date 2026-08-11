/**
 * Launches waiting on the console. One record per nonce, in session storage, which is memory-backed:
 * the address the person asked for never reaches disk.
 *
 * Its own module because the two sides need it and must not need each other: `router.js` opens a
 * record before it navigates, `handoff.js` reads one when the console answers.
 */

import { sessionMap } from './session-map.js';

/**
 * @typedef {{
 *   url: string, targetOrigin: string, tabId: number, originalUrl: string,
 *   tried: string[], endpoint: string, createdAt: number, probed: boolean
 * }} Pending
 */

// Long enough for a slow console and a person who reads before pressing, short enough that a
// forgotten record cannot answer for a launch nobody remembers starting.
const PENDING_TTL_MS = 5 * 60 * 1000;

/** 16 bytes, base64url, unpadded. */
function newNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const store = /** @type {import('./session-map.js').SessionMap<Pending>} */ (sessionMap('pending'));

/** Expiry is enforced on every read, so no timer has to survive the worker. @param {number} now */
const live = (/** @type {Record<string, Pending>} */ records, now) =>
  Object.fromEntries(Object.entries(records).filter(([, r]) => now - r.createdAt < PENDING_TTL_MS));

/**
 * @param {Omit<Pending, 'createdAt'|'probed'>} record
 * @returns {Promise<string>} the nonce that stands for it
 */
export async function openPending(record) {
  const nonce = newNonce();
  const now = Date.now();
  await store.update((records) =>
    [{ ...live(records, now), [nonce]: { ...record, createdAt: now, probed: false } }, null]);
  return nonce;
}

/** Does not consume: the console may reload, and a reload has to find its address again. */
export async function readPending(/** @type {string} */ nonce) {
  return live(await store.read(), Date.now())[nonce] ?? null;
}

/** The console arrived. Told apart from silence, which is what the watchdog acts on. */
export function markProbed(/** @type {string} */ nonce) {
  return store.update((raw) => {
    const records = live(raw, Date.now());
    if (!records[nonce]) return [raw, null];
    const probed = { ...records[nonce], probed: true };
    return [{ ...records, [nonce]: probed }, probed];
  });
}

/** Consumes. A nonce spends once, so a replayed handoff finds nothing. */
export function takePending(/** @type {string} */ nonce) {
  return store.update((raw) => {
    const records = live(raw, Date.now());
    const record = records[nonce] ?? null;
    delete records[nonce];
    return [records, record];
  });
}

/** The launch this tab is in the middle of, if any. @param {number} tabId */
export async function pendingForTab(tabId) {
  const records = live(await store.read(), Date.now());
  const found = Object.entries(records).find(([, r]) => r.tabId === tabId);
  return found ? { nonce: found[0], ...found[1] } : null;
}

/** @param {number} tabId @returns {Promise<string[]>} the nonces that died with it */
export function dropPendingForTab(tabId) {
  return store.update((raw) => {
    const records = live(raw, Date.now());
    const dead = Object.keys(records).filter((n) => records[n].tabId === tabId);
    for (const nonce of dead) delete records[nonce];
    return [dead.length ? records : raw, dead];
  });
}

/**
 * A launch for this tab that ran out of time, consumed on the way out. Reads the stored set rather
 * than the live one on purpose: an expired record is precisely what `live` exists to hide, and it is
 * also the last thing holding the address someone asked for. Nothing announces the expiry, so this
 * runs where somebody is looking.
 *
 * @param {number} tabId
 */
export function takeExpiredForTab(tabId) {
  return store.update((records) => {
    const now = Date.now();
    const found = Object.entries(records)
      .find(([, r]) => r.tabId === tabId && now - r.createdAt >= PENDING_TTL_MS);
    if (!found) return [records, null];
    const { [found[0]]: gone, ...rest } = records;
    return [rest, { nonce: found[0], ...found[1] }];
  });
}
