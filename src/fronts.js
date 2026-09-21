/**
 * Which of our addresses to open, and which of them is reachable from here.
 *
 * One address ships in this build and is the only one a censor gets for free: it is on the store
 * listing and in search results, so it is blocked first and losing it costs nothing that was not
 * already lost. Every other address arrives in the signed record, so burning one costs us a
 * signature rather than a release, and reading the list costs an attacker a live lookup rather than
 * one afternoon with the archive.
 */

import { CATALOG, readSettings, SEED_MIRRORS, sessionOrigins } from './config.js';
import {
  acceptsCatalog,
  parseCatalog,
  parseRevocation,
  verifyCatalog,
  verifyRevocation,
} from './catalog.js';
import { lookupTxt } from './doh.js';

const KEY = 'fronts';
const REVOKED = 'fronts-revoked';

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
 * Whether the signing key has been taken out of trust. The stored form is the record itself and the
 * signature is checked on every read, not once on the way in: a flag would be a claim about the
 * past, and this has to be a claim about the key.
 *
 * Terminal by construction. Nothing lifts a revocation, because nothing the key can sign is trusted
 * after it. A client comes back only through a build carrying a different pinned key.
 *
 * @returns {Promise<boolean>}
 */
export async function catalogRevoked() {
  const text = /** @type {unknown} */ ((await chrome.storage.local.get(REVOKED))[REVOKED]);
  if (typeof text !== 'string') return false;
  const revocation = parseRevocation(text, CATALOG.publicKey);
  return revocation ? verifyRevocation(revocation, CATALOG.publicKey) : false;
}

/**
 * Looks the record up, verifies it, and keeps it only if it is newer than what we hold. Every
 * failure leaves the stored list exactly as it was: a network that answers nothing and a network
 * that answers a lie must both end with the addresses that worked last time.
 *
 * @returns {Promise<boolean>} whether the stored list changed
 */
export async function refreshCatalog() {
  // Nothing to learn once the key is out of trust, and asking anyway would be two observable
  // requests a wake-up for no possible answer. The kill switch takes the lookup with it.
  if (await catalogRevoked()) return false;

  // Each anchor in turn, and the first one that yields anything usable ends the round. An anchor
  // that answers nothing is one whose domain is gone; an anchor that answers rubbish is one whose
  // domain is in somebody else's hands, and neither can produce a record this key signed.
  for (const name of CATALOG.records) {
    const records = await lookupTxt(name);
    if (records.length && (await applyRecords(records))) return true;
  }
  return false;
}

/**
 * What one anchor's answer is worth: a revocation if it carries one, otherwise a newer list.
 *
 * @param {string[]} records
 * @returns {Promise<boolean>} whether anything was stored
 */
async function applyRecords(records) {
  // The revocation is read before the catalog, so a round carrying both never stores a list. The
  // write lands BEFORE the list is dropped: a client that died between the two would otherwise
  // wake with no list and its trust in the key intact, and learn the poisoned list all over again.
  for (const text of records) {
    const revocation = parseRevocation(text, CATALOG.publicKey);
    if (!revocation) continue;
    if (!(await verifyRevocation(revocation, CATALOG.publicKey))) continue;
    await chrome.storage.local.set({ [REVOKED]: text });
    await chrome.storage.local.remove(KEY);
    return true;
  }

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
  // A revoked key means the record is worth nothing, so the walk is the addresses this build ships
  // with and the one the owner typed. The removal in `refreshCatalog` is hygiene; this check is the
  // mechanism, because storage is state and state can come back.
  if (await catalogRevoked()) return [...new Set(endpoints)];
  const stored = await storedCatalog();
  const fromRecord = stored?.hosts.map((h) => `https://${h}`) ?? [];
  // A DoH-blocking filter leaves a fresh install with no list; the seed is what it walks on.
  const seed = stored ? [] : SEED_MIRRORS.map((h) => `https://${h}`);
  return [...new Set([...endpoints, ...fromRecord, ...seed])];
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
 * Called with nothing to walk, it throws rather than answering `undefined` under a type that says
 * otherwise: the caller has already lost track of where the tab is going, and a tab sent to the
 * string "undefined" ends up on a browser error page with its fence already taken off.
 *
 * @param {string[]} ordered
 */
export async function firstReachable(ordered) {
  if (!ordered.length) throw new Error('no address to reach for');
  for (let i = 0; i < ordered.length; i += 1) {
    const last = i === ordered.length - 1;
    if (last || await reachable(ordered[i])) return ordered[i];
  }
  return ordered[0];
}
