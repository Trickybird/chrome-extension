/** Settings. */

/** @typedef {{ endpoints: string[], autoRecover: boolean }} Settings */

/** Shipped address. Anything else is granted at the moment it is added. */
export const DEFAULT_ENDPOINTS = ['https://trickybird.com'];

const KEY = 'settings';

/** @returns {Promise<Settings>} */
export async function readSettings() {
  const stored = /** @type {Partial<Settings> & { sessionEndpoint?: string }} */ (
    (await chrome.storage.local.get(KEY))[KEY] ?? {});
  const carried = stored.sessionEndpoint ? [stored.sessionEndpoint] : DEFAULT_ENDPOINTS;
  return {
    endpoints: stored.endpoints?.length ? stored.endpoints : carried,
    autoRecover: stored.autoRecover ?? false,
  };
}

/** @param {Partial<Settings>} patch */
export async function writeSettings(patch) {
  const next = { ...(await readSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/** Origins to grant before a session can be asked for; an address may carry a path. @param {string[]} endpoints */
export function sessionOrigins(endpoints) {
  return endpoints.flatMap((e) => {
    try {
      return [new URL(e).origin];
    } catch {
      return [];
    }
  });
}

/**
 * A page on our own site. Follows the configured address, so a mirror keeps its own links.
 * @param {string[]} endpoints @param {string} path
 */
export function siteLink(endpoints, path) {
  const [origin] = sessionOrigins(endpoints);
  return origin ? `${origin}${path}` : '';
}
