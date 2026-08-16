/** Which session address to try, and in what order. Pure. */

/**
 * Keeps https addresses in the order given, without their trailing slash.
 * @param {string[]} list
 */
export function normalize(list) {
  const seen = new Set();
  return list.flatMap((raw) => {
    const value = String(raw).trim().replace(/\/+$/, '');
    if (seen.has(value)) return [];
    let url;
    try {
      url = new URL(value);
    } catch {
      return [];
    }
    if (url.protocol !== 'https:') return [];
    seen.add(value);
    return [value];
  });
}

/**
 * The one that answered last goes first; the rest keep the order they were configured in, because
 * sort is stable.
 * @param {string[]} list @param {string|null} lastGood
 */
export function order(list, lastGood) {
  return [...list].sort((a, b) => Number(b === lastGood) - Number(a === lastGood));
}

// Only success is recorded, and only the one address. Nothing remembers which addresses failed, so a
// dead one is simply not preferred rather than blacklisted, and it starts being tried again the moment
// it answers. That asymmetry is deliberate: a failure list on a client that sees one network from one
// place would turn a local outage into a permanent verdict about a live endpoint.
const LAST_GOOD = 'lastGoodEndpoint';

/** @param {string} endpoint */
export const remember = (endpoint) => chrome.storage.local.set({ [LAST_GOOD]: endpoint });

/** @param {string[]} list */
export async function preferred(list) {
  const stored = (await chrome.storage.local.get(LAST_GOOD))[LAST_GOOD];
  return order(list, typeof stored === 'string' ? stored : null);
}
