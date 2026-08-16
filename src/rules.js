/**
 * The per-tab rule table. Pure.
 *
 *   3 allow   loopback and private addresses
 *   1 allow   a whole-page navigation back to our own console
 *   1 block   everything in this tab that is not the proxy
 *   1 block   everything the proxy's own origin asks for that is not the proxy
 *
 * Only these two actions appear here, and that is the whole reason the extension never asks for
 * access to a site: Chrome requires host access for `redirect` and `modifyHeaders`, and for nothing
 * else. A tab is sent to the proxy by ordinary navigation instead, and these rules fence it in.
 */

import { isPrivateHost } from './target.js';

export const PRIORITY = { allowPrivate: 2, catchAll: 1 };
export const MAX_RULE_ID = 2147483647;

/** Every request type, so the catch-all covers subresources and sockets too, not just documents. */
const ALL_TYPES = /** @type {const} */ ([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport',
  'webbundle', 'other',
]);

/**
 * Addresses inside a local network. Three patterns rather than one: Chrome compiles each
 * regexFilter into a 2KB budget and the combined pattern is rejected at install time.
 */
const LOCAL_PATTERNS = [
  '^https?://([^./:]+|[^/:]+\\.local)(:[0-9]+)?([/?#]|$)',
  '^https?://(127|10|192\\.168|169\\.254|172\\.(1[6-9]|2[0-9]|3[01]))\\.[0-9.]+(:[0-9]+)?([/?#]|$)',
  '^https?://\\[?(::1|f[cde][0-9a-f]*:)',
];

/** Where the catch-all sits inside a base: the private patterns, then the way home. */
const CATCH_ALL_OFFSET = LOCAL_PATTERNS.length + 1;
const RULES_PER_TAB = CATCH_ALL_OFFSET + 2;

/**
 * @param {{ tabId: number, origin: string, endpoint: string, consoleHosts: string[],
 *   baseId: number }} spec
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
export function buildTabRules({ tabId, origin, endpoint, consoleHosts, baseId }) {
  const target = new URL(origin);
  if (isPrivateHost(target.hostname)) {
    throw new Error(`refusing to route a private host: ${target.hostname}`);
  }
  // A fence with no way home is the defect this argument exists to prevent, so an empty list is a
  // programming error rather than a fence that quietly traps whoever is behind it.
  if (!consoleHosts.length) throw new Error('a fence needs at least one console host to allow');
  if (!Number.isInteger(baseId) || baseId < 1 || baseId + RULES_PER_TAB - 1 > MAX_RULE_ID) {
    throw new Error(`rule base id ${baseId} is out of range`);
  }
  const endpointHost = new URL(endpoint).hostname;

  return [
    ...LOCAL_PATTERNS.map((regexFilter, i) => ({
      id: baseId + i,
      priority: PRIORITY.allowPrivate,
      action: { type: /** @type {const} */ ('allow') },
      condition: { tabIds: [tabId], regexFilter, resourceTypes: [...ALL_TYPES] },
    })),
    // The page has ways home the extension never drives: the toolbar's home button, and the
    // redirect the gateway sends once a session runs out. Both are a whole-page navigation to our
    // own console, and the catch-all below blocked them, so a session simply expiring left the
    // person on Chrome's page blaming an extension. Only `main_frame` passes: a proxied page still
    // cannot fetch, ping or beacon our console, and those are the shapes that would carry a report
    // about whoever is reading.
    {
      id: baseId + LOCAL_PATTERNS.length,
      priority: PRIORITY.allowPrivate,
      action: { type: /** @type {const} */ ('allow') },
      condition: {
        tabIds: [tabId],
        requestDomains: [...consoleHosts],
        resourceTypes: [/** @type {const} */ ('main_frame')],
      },
    },
    {
      id: baseId + CATCH_ALL_OFFSET,
      priority: PRIORITY.catchAll,
      action: { type: /** @type {const} */ ('block') },
      condition: {
        tabIds: [tabId],
        urlFilter: '*',
        excludedRequestDomains: [endpointHost],
        resourceTypes: [...ALL_TYPES],
      },
    },
    // A service worker's request belongs to no tab, so every rule above misses it and a proxied page
    // could reach the real site by registering one. Measured, then measured again with this rule:
    // the same fetch is blocked and the server sees nothing. Scoped by who asked rather than by
    // which tab, which is why it has no `tabIds`; it costs nothing outside the proxy's own origin.
    {
      id: baseId + CATCH_ALL_OFFSET + 1,
      priority: PRIORITY.catchAll,
      action: { type: /** @type {const} */ ('block') },
      condition: {
        initiatorDomains: [endpointHost],
        urlFilter: '*',
        excludedRequestDomains: [endpointHost],
        resourceTypes: [...ALL_TYPES],
      },
    },
  ];
}

/**
 * Reads a tab's fence back out of the installed rules, so a restarted service worker needs no other
 * state to know which tabs are routed, and through which proxy.
 *
 * @param {chrome.declarativeNetRequest.Rule[]} installed
 * @param {number} tabId
 */
export function readTabRule(installed, tabId) {
  const fence = installed.find((r) =>
    r.priority === PRIORITY.catchAll
    && r.condition.tabIds?.length === 1
    && r.condition.tabIds[0] === tabId);
  if (!fence) return null;
  return {
    baseId: fence.id - CATCH_ALL_OFFSET,
    endpointHost: fence.condition.excludedRequestDomains?.[0] ?? '',
  };
}

/** Ids a base occupies. @param {number} baseId */
export const ruleIdsForBase = (baseId) =>
  Array.from({ length: RULES_PER_TAB }, (_, i) => baseId + i);

/**
 * Next free base. Tab ids are unusable here: three times a real one overflows int32.
 * @param {{ id: number }[]} installed
 */
export function allocateBaseId(installed) {
  const highest = installed.reduce((/** @type {number} */ max, r) => (r.id > max ? r.id : max), 0);
  const next = highest + 1;
  if (next + RULES_PER_TAB - 1 > MAX_RULE_ID) throw new Error('rule id space exhausted');
  return next;
}
