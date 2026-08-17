/**
 * The rule table. Pure.
 *
 * One MARKER per routed tab, and one FENCE per gateway however many tabs use it:
 *
 *   marker  1 rule   this tab is routed, and through this gateway
 *   fence   2 rules  the proxied page's way home, and the block that holds it
 *
 * The fence holds the PAGE, not the tab. Everything a proxied page asks for carries the gateway as
 * its initiator, so one rule scoped to that catches all of it, navigation included. The tab it sits
 * in belongs to the person — an address they type, a bookmark, the back button, a link another
 * application opens — and each of those arrives with no initiator at all, so a rule scoped to the tab
 * refused them too. That cost them the tab and then cost them the page they went to, whose
 * stylesheets and scripts were refused the same way.
 *
 * A request with no initiator raised from INSIDE a proxied page is the case a tab-scoped rule used to
 * cover, and it means a document with an opaque origin. Those belong to the gateway, which is the
 * only place they are closed for everyone rather than for the minority who installed this: it
 * refuses a `data:` frame outright and repairs a `sandbox` that would make one, both measured. The
 * extension never covered any of that for the people who arrive through the website, most of them.
 *
 * The fence is per gateway rather than per tab because it names no tab. Installing a copy of it
 * behind every fenced tab meant the last tab to be forgotten took browser-wide containment with it,
 * and meant N identical rules whose console lists were each frozen at a different moment.
 *
 * Only `allow` and `block` appear here, and that is the whole reason the extension never asks for
 * access to a site: Chrome requires host access for `redirect` and `modifyHeaders`, and for nothing
 * else. A tab is sent to the proxy by ordinary navigation instead, and these rules hold what lands.
 */

import { isPrivateHost } from './target.js';

export const PRIORITY = { pass: 2, fence: 1 };
export const MAX_RULE_ID = 2147483647;

/** Every request type, so the fence covers subresources and sockets too, not just documents. */
const ALL_TYPES = /** @type {const} */ ([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport',
  'webbundle', 'other',
]);

export const FENCE_RULES = 2;

/**
 * The record that this tab is routed. Inert as a rule: it allows a whole-page load from the gateway,
 * which the fence already permits by excluding that host, so it can widen nothing. `allow` is simply
 * the action that does nothing, and a rule is the only place a service worker with no memory can
 * read this back after a restart.
 *
 * @param {{ tabId: number, origin: string, endpoint: string, id: number }} spec
 * @returns {chrome.declarativeNetRequest.Rule}
 */
export function buildMarker({ tabId, origin, endpoint, id }) {
  const target = new URL(origin);
  if (isPrivateHost(target.hostname)) {
    throw new Error(`refusing to route a private host: ${target.hostname}`);
  }
  assertId(id);
  return {
    id,
    priority: PRIORITY.pass,
    action: { type: /** @type {const} */ ('allow') },
    condition: {
      tabIds: [tabId],
      requestDomains: [new URL(endpoint).hostname],
      resourceTypes: [/** @type {const} */ ('main_frame')],
    },
  };
}

/**
 * The fence, and the one way out of it. Neither names a tab: a proxied page exists in tabs this
 * extension never launched, and a service worker's request belongs to no tab at all.
 *
 * @param {{ endpoint: string, consoleHosts: string[], baseId: number }} spec
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
export function buildFence({ endpoint, consoleHosts, baseId }) {
  // A fence with no way home is the defect this argument exists to prevent, so an empty list is a
  // programming error rather than a fence that quietly traps whoever is behind it.
  if (!consoleHosts.length) throw new Error('a fence needs at least one console host to allow');
  assertId(baseId);
  assertId(baseId + FENCE_RULES - 1);
  const endpointHost = new URL(endpoint).hostname;

  return [
    // The page has ways home the extension never drives: the toolbar's home button, and the redirect
    // an expired session sends. Both are a whole-page navigation to our own site, and both belong to
    // somebody who came through the web console with no extension in the story. Only the navigation
    // is opened. A proxied page still cannot fetch, ping or beacon the console, and those are the
    // shapes that would carry a report about whoever is reading.
    {
      id: baseId,
      priority: PRIORITY.pass,
      action: { type: /** @type {const} */ ('allow') },
      condition: {
        initiatorDomains: [endpointHost],
        requestDomains: [...consoleHosts],
        resourceTypes: [/** @type {const} */ ('main_frame')],
      },
    },
    // Scoped by who asked rather than by which tab. Measured in a real Chromium: with this rule the
    // page's own fetch to the real host is refused and the server sees nothing, and so is its fetch
    // to a loopback address, which is why nothing private is excluded here.
    {
      id: baseId + 1,
      priority: PRIORITY.fence,
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
 * Reads a tab's marker back out of the installed rules, so a restarted service worker needs no other
 * state to know which tabs are routed, and through which proxy.
 *
 * @param {chrome.declarativeNetRequest.Rule[]} installed
 * @param {number} tabId
 */
export function readTabRule(installed, tabId) {
  const marker = installed.find((r) => r.condition.tabIds?.length === 1
    && r.condition.tabIds[0] === tabId);
  if (!marker) return null;
  // Single-element by construction, and a marker is refused a second host, so this is not a guess.
  return { id: marker.id, endpointHost: marker.condition.requestDomains?.[0] ?? '' };
}

/** Gateways that at least one tab is routed through. @param {chrome.declarativeNetRequest.Rule[]} installed */
export const routedEndpoints = (installed) =>
  new Set(installed.flatMap((r) => (r.condition.tabIds?.length
    ? [r.condition.requestDomains?.[0] ?? ''] : [])));

/**
 * Ids of the fence standing for one gateway, empty when none does.
 * @param {chrome.declarativeNetRequest.Rule[]} installed @param {string} endpointHost
 */
export const readFence = (installed, endpointHost) =>
  installed.filter((r) => !r.condition.tabIds?.length
    && r.condition.initiatorDomains?.[0] === endpointHost).map((r) => r.id);

/**
 * Ids nothing has taken. Deriving them from a tab id would collide, because Chrome reuses tab ids.
 * @param {{ id: number }[]} installed @param {number} count
 */
export function allocateIds(installed, count) {
  const highest = installed.reduce((/** @type {number} */ max, r) => (r.id > max ? r.id : max), 0);
  if (highest + count > MAX_RULE_ID) throw new Error('rule id space exhausted');
  return Array.from({ length: count }, (_, i) => highest + 1 + i);
}

/** @param {number} id */
function assertId(id) {
  if (!Number.isInteger(id) || id < 1 || id > MAX_RULE_ID) {
    throw new Error(`rule id ${id} is out of range`);
  }
}
