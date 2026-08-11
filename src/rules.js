/**
 * The per-tab rule table. Pure.
 *
 *   2 allow   loopback and private addresses
 *   1 block   everything in this tab that is not the proxy
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

const RULES_PER_TAB = LOCAL_PATTERNS.length + 1;

/**
 * @param {{ tabId: number, origin: string, endpoint: string, baseId: number }} spec
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
export function buildTabRules({ tabId, origin, endpoint, baseId }) {
  const target = new URL(origin);
  if (isPrivateHost(target.hostname)) {
    throw new Error(`refusing to route a private host: ${target.hostname}`);
  }
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
    {
      id: baseId + LOCAL_PATTERNS.length,
      priority: PRIORITY.catchAll,
      action: { type: /** @type {const} */ ('block') },
      condition: {
        tabIds: [tabId],
        urlFilter: '*',
        excludedRequestDomains: [endpointHost],
        resourceTypes: [...ALL_TYPES],
      },
    },
  ];
}

/**
 * Reads a tab's fence back out of the installed rules, so a service worker restart needs no other
 * state to know which tabs are routed and through which proxy.
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
    baseId: fence.id - LOCAL_PATTERNS.length,
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
