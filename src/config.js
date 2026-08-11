/** Settings. */

/** @typedef {{ endpoints: string[], autoRecover: boolean }} Settings */

/**
 * Which build this is. It rides on every launch link so the funnel can tell an extension launch from
 * someone typing an address, AND tell the builds apart: there will be more than one browser, and a
 * marker that only says "an extension" stops answering the question the day the second one ships.
 */
export const EXTENSION_BUILD = 'chrome';

/** The one address that ships. Every other one arrives in the signed record; see fronts.js. */
export const DEFAULT_ENDPOINTS = ['https://trickybird.com'];

/**
 * The console a developer runs behind their own Caddy. It is named in `externally_connectable` so
 * the extension can be loaded straight from the repository and pointed at a local stack from the
 * settings page, with no patched copy to keep in step.
 *
 * It costs nothing anywhere else. `.test` never resolves on the public internet, so no page can
 * exist on that origin unless the machine was told where it lives; and even then a message from it
 * is refused, because the sender's origin still has to be one of the addresses this install is
 * configured to open, and that is `trickybird.com` unless somebody changed it by hand.
 */
export const DEV_ENDPOINT = 'https://tb-front.test';

/**
 * Where the rest of the addresses come from.
 *
 * `publicKey` is a public key and belongs here; the private half signs the record and lives with the
 * production secrets, never in this repository. `minVersion` is the floor a fresh install starts
 * from: a stored version stops a replayed record, but an install that has never seen one has nothing
 * to compare against, so the floor rises with each release that publishes a new list.
 */
export const CATALOG = {
  record: '_fronts.trickybird.com',
  publicKey: 'BHorlFrC9M___o2wBgfu1s2flc6C2vzs_DkC6THEwtpQ4h70WWpMH401cei5InjqtqNl2F9lGNLav4zBTS4zMIU',
  minVersion: 1,
};

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
