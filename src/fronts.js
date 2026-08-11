/**
 * Which of our addresses to open, and which of them is reachable from here.
 *
 * One address ships in this build and is the only one a censor gets for free: it is on the store
 * listing and in search results, so it is blocked first and losing it costs nothing that was not
 * already lost. Every other address arrives in the signed record, so burning one costs us a
 * signature rather than a release, and reading the list costs an attacker a live lookup rather than
 * one afternoon with the archive.
 */

import { CATALOG, readSettings, sessionOrigins } from './config.js';
import { acceptsCatalog, parseCatalog, verifyCatalog } from './catalog.js';
import { lookupTxt } from './doh.js';

const KEY = 'fronts';

// One round trip on a working network. Past this the address is treated as unreachable, and being
// wrong about that is cheap: the walk moves on and nothing is remembered.
const PROBE_TIMEOUT_MS = 1500;

/** @typedef {{ version: number, hosts: string[] }} Stored */

/** @returns {Promise<Stored|null>} */
export async function storedCatalog() {
  const value = /** @type {Stored|undefined} */ ((await chrome.storage.local.get(KEY))[KEY]);
  return value && Array.isArray(value.hosts) ? value : null;
}

/**
 * Looks the record up, verifies it, and keeps it only if it is newer than what we hold. Every
 * failure leaves the stored list exactly as it was: a network that answers nothing and a network
 * that answers a lie must both end with the addresses that worked last time.
 *
 * @returns {Promise<boolean>} whether the stored list changed
 */
export async function refreshCatalog() {
  const records = await lookupTxt(CATALOG.record);
  const stored = await storedCatalog();
  const floor = CATALOG.minVersion;

  for (const text of records) {
    const catalog = parseCatalog(text);
    if (!catalog) continue;
    if (!acceptsCatalog(catalog, stored?.version ?? 0, floor)) continue;
    if (!(await verifyCatalog(catalog, CATALOG.publicKey))) continue;
    await chrome.storage.local.set({ [KEY]: { version: catalog.version, hosts: catalog.hosts } });
    return true;
  }
  return false;
}

/**
 * Everything worth trying, configured address first. That one leads because on an unblocked network
 * it is the one that works, and it is the only one that needs no lookup to have been made. It is
 * also the only one anybody can change by hand, which is what makes a local stack testable.
 * @returns {Promise<string[]>}
 */
export async function frontEndpoints() {
  const { endpoints } = await readSettings();
  const fromRecord = (await storedCatalog())?.hosts.map((h) => `https://${h}`) ?? [];
  return [...new Set([...endpoints, ...fromRecord])];
}

/**
 * Whether a tab is standing on one of our own consoles. Pure, and here rather than in the popup
 * because the popup should not be the only thing that knows what counts as ours.
 *
 * @param {string|undefined} url @param {string[]} endpoints
 */
export function isOurOwnConsole(url, endpoints) {
  try {
    return sessionOrigins(endpoints).includes(new URL(String(url)).origin);
  } catch {
    return false;
  }
}

/**
 * Whether this address is allowed to speak to us, which decides how a launch hands over. Read from
 * the manifest rather than from a constant beside it: the manifest is what Chrome actually enforces,
 * and a second copy of that list is a second thing to get wrong.
 *
 * @param {string} origin
 */
export function canAnswerUs(origin) {
  const matches = chrome.runtime.getManifest().externally_connectable?.matches ?? [];
  return matches.some((pattern) => {
    try {
      return new URL(pattern.replace(/\*$/, '')).origin === origin;
    } catch {
      return false;
    }
  });
}

/**
 * Whether this address answers at all. Opaque on purpose: `no-cors` needs no header from the server
 * and no permission from the browser, and the only question here is whether the bytes come back.
 *
 * It cannot tell our console from a captive portal that answers everything, and it is not asked to:
 * a wrong answer costs one page load, which is what the launch already pays today.
 *
 * @param {string} origin
 */
async function reachable(origin) {
  try {
    await fetch(`${origin}/api/health`, {
      mode: 'no-cors',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The first address that answers, or the last candidate when none does. Never returns nothing: the
 * probe is a fast path, not a gate. A censor who adds two seconds of latency to our addresses is
 * cheaper for himself than blocking them, and a client that treats slow as dead does his work.
 *
 * Serial, not a race: a parallel round would put every address we know on the wire at once, at a
 * moment the censor chose by blocking the first one.
 *
 * @param {string[]} ordered
 */
export async function firstReachable(ordered) {
  for (let i = 0; i < ordered.length; i += 1) {
    const last = i === ordered.length - 1;
    if (last || await reachable(ordered[i])) return ordered[i];
  }
  return ordered[0];
}
