/** Routes and unroutes a tab. The only module that touches rules or navigates. */

import {
  allocateIds, buildFence, buildMarker, FENCE_RULES, readFence, readTabRule, routedEndpoints,
} from './rules.js';
import { setBadge } from './badge.js';
import { sessionMap } from './session-map.js';
import { targetFragment, ticketFragment } from './fragment.js';
import { classify, NotRoutable } from './target.js';
import { fromProxyUrl } from './proxy-url.js';
import { normalize, preferred } from './endpoints.js';
import { openPending, pendingForTab, takePending } from './pending.js';
import { EXTENSION_BUILD, sessionOrigins } from './config.js';
import { canAnswerUs, firstReachable, frontEndpoints, isOurOwnConsole } from './fronts.js';
import { ErrorCode, RoutingError } from './errors.js';

const sessionRules = () => chrome.declarativeNetRequest.getSessionRules();

/**
 * The site's name, kept beside the rules because Chrome will not tell the background what a tab is
 * showing. The rules stay the truth; this is a caption, so on disagreement it goes blank, not wrong.
 *
 * Through the same queue as every other set here. Read-modify-write against storage is not atomic,
 * and two tabs routed in the same moment each read this map and each write it back: one label is
 * lost, or one that was just deleted comes back to caption a tab it does not belong to.
 */
const labelStore = /** @type {import('./session-map.js').SessionMap<string>} */
  (sessionMap('routedOrigins'));

/** @returns {Promise<Record<string, string>>} */
const labels = () => labelStore.read();

/** @param {number} tabId @param {string} origin */
const label = (tabId, origin) =>
  labelStore.update((records) => [{ ...records, [String(tabId)]: origin }, null]);

/** @param {number} tabId */
const forgetLabel = (tabId) => labelStore.update((records) => {
  if (!records[String(tabId)]) return [records, null];
  const { [String(tabId)]: gone, ...rest } = records;
  return [rest, null];
});

/**
 * Retires one tab's marker, and the gateway's fence with it once no tab is left behind that fence.
 * Clearing every rule instead would un-fence tabs that are still showing a proxied page, silently
 * and with nothing left to stop them reaching anywhere.
 *
 * @param {number} tabId
 */
async function clearTab(tabId) {
  const marker = readTabRule(await sessionRules(), tabId);
  if (!marker) return;
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [marker.id] });
  const left = await sessionRules();
  if (routedEndpoints(left).has(marker.endpointHost)) return;
  const orphaned = readFence(left, marker.endpointHost);
  if (orphaned.length) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: orphaned });
  }
}

/**
 * Fenced is not the same as showing a proxied page. The caller passes the address, because reading
 * it here would need access to the proxy.
 *
 * @param {number} tabId
 * @param {string} [shownUrl]
 */
export async function stateOf(tabId, shownUrl) {
  const shown = fromProxyUrl(shownUrl ?? '');
  const rule = readTabRule(await sessionRules(), tabId);
  if (!rule) {
    // A launch in flight is the difference between "waiting on a press" and "nothing is happening",
    // and it carries the one address a cancel can return the tab to.
    const waiting = await pendingForTab(tabId);
    if (waiting) {
      return { routed: false, proxied: Boolean(shown), origin: shown?.origin ?? '',
        waitingFrom: waiting.originalUrl };
    }
    // A tab can be showing a proxied page with no fence around it: an address that cannot answer us
    // never gets one installed. The page is still ours and the way back still has to be offered,
    // or the person is left on it with a panel that acts as though nothing happened.
    return { routed: false, proxied: Boolean(shown), origin: shown?.origin ?? '' };
  }
  return {
    routed: true,
    proxied: Boolean(shown),
    origin: shown?.origin ?? (await labels())[String(tabId)] ?? '',
    // null is "we could not read the address", which is not evidence of anything. Reading it as
    // false is what made a perfectly routed tab report that nothing came back.
    proven: shownUrl ? Boolean(shown && new URL(shown.endpoint).hostname === rule.endpointHost) : null,
  };
}

/**
 * Where a tab goes to be launched from: our own address, carrying the build marker so the funnel can
 * tell an extension launch from someone typing, and the fragment that says what to open.
 * @param {string} origin @param {string} fragment
 */
const consoleUrl = (origin, fragment) => `${origin}/?ext=${EXTENSION_BUILD}${fragment}`;

/** base64url of a UTF-8 string, the same shape the bootstrap's `d` uses. @param {string} value */
const encodeTarget = (value) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Sends the tab to one of our addresses with the destination in hand. No session is minted here: the
 * console mints, through the same door every visitor uses.
 *
 * Two ways over, and the address decides which. The one that ships can answer us, because
 * `externally_connectable` names it, so the destination stays here under a nonce and the console
 * asks; its reply is what lets us fence the tab. An address that arrived in the signed record cannot
 * answer, because that list is fixed at build time and it is not on it, so the destination rides in
 * the fragment and the tab goes unfenced. Unfenced is what every visitor to the site already gets,
 * and it beats a mirror that cannot launch at all.
 *
 * `tried` carries the addresses this launch has already spent, so the walk moves forward.
 *
 * @param {{ tabId: number, url: string, originalUrl?: string, tried?: string[] }} req
 * @returns {Promise<{ ok: true, endpoint: string, nonce?: string }>}
 */
export async function launch({ tabId, url, originalUrl, tried = [] }) {
  const target = classify(url);
  if (!target.ok) {
    throw new RoutingError(ErrorCode.NOT_ROUTABLE, target.reason ?? NotRoutable.scheme);
  }

  const ordered = (await preferred(normalize(await frontEndpoints())))
    .filter((e) => !tried.includes(e));
  if (!ordered.length) {
    if (originalUrl) await sendAway(tabId, originalUrl).catch(() => {});
    await setBadge(tabId, 'attention');
    throw new RoutingError(ErrorCode.ENDPOINT_UNREACHABLE, `tried ${tried.length}`);
  }
  const endpoint = await firstReachable(ordered);
  const [origin] = sessionOrigins([endpoint]);

  await setBadge(tabId, 'busy');
  /** @type {string|undefined} */
  let nonce;
  if (canAnswerUs(origin)) {
    nonce = await openPending({
      url, targetOrigin: target.origin, tabId, originalUrl: originalUrl ?? url, tried, endpoint,
    });
  }
  // Either way the destination is in the fragment, which no server ever sees. The nonce says nothing
  // even to the page that reads it; the address says what the person asked for and nothing more.
  const fragment = nonce ? ticketFragment(nonce) : targetFragment(encodeTarget(url));

  await sendAway(tabId, consoleUrl(origin, fragment)).catch(async () => {
    // The record is opened before the navigation, so a tab that dies in between leaves it bound to
    // an id Chrome will hand to somebody else. The panel on that stranger's tab would then offer to
    // finish a launch they never started.
    if (nonce) await takePending(nonce);
    throw new RoutingError(ErrorCode.TAB_GONE, 'tab closed');
  });
  return { ok: /** @type {true} */ (true), endpoint, nonce };
}

/**
 * Installs the tab's fence, reads it back, and only then sends the tab to the proxy. The read-back
 * is the whole point: rules that did not take would put a proxied page in a tab with nothing
 * holding it in.
 *
 * @param {{ tabId: number, targetOrigin: string, proxyUrl: string }} req
 */
export async function fence({ tabId, targetOrigin, proxyUrl }) {
  const still = await chrome.tabs.get(tabId).catch(() => null);
  if (!still) throw new RoutingError(ErrorCode.TAB_GONE, 'tab closed');

  const endpoint = new URL(proxyUrl).origin;
  // Read here rather than in `buildFence`, which is pure and cannot await: the fence has to name
  // the addresses this install would open, so the page's own way home is never the thing we block.
  const consoleHosts = sessionOrigins(await frontEndpoints()).map((o) => new URL(o).hostname);
  const endpointHost = new URL(endpoint).hostname;
  await clearTab(tabId);
  const standing = await sessionRules();
  // The fence is shared, so a second tab through the same gateway adds a marker and nothing else.
  const wanted = readFence(standing, endpointHost).length ? 0 : FENCE_RULES;
  const [markerId, ...fenceIds] = allocateIds(standing, 1 + wanted);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        buildMarker({ tabId, origin: targetOrigin, endpoint, id: markerId }),
        ...(wanted ? buildFence({ endpoint, consoleHosts, baseId: fenceIds[0] }) : []),
      ],
    });
  } catch (e) {
    throw new RoutingError(ErrorCode.NO_SESSION, String(e));
  }

  const settled = await sessionRules();
  const installed = readTabRule(settled, tabId);
  if (!installed || installed.endpointHost !== endpointHost || !readFence(settled, endpointHost).length) {
    await chrome.declarativeNetRequest
      .updateSessionRules({ removeRuleIds: [markerId, ...fenceIds] }).catch(() => {});
    throw new RoutingError(ErrorCode.NO_SESSION, 'rules did not take');
  }
  await label(tabId, targetOrigin);

  try {
    await chrome.tabs.update(tabId, { url: proxyUrl });
  } catch {
    // Chrome reuses tab ids, so rules left on a dead one land on whoever gets that id next.
    await forgetTab(tabId);
    throw new RoutingError(ErrorCode.TAB_GONE, 'tab closed');
  }
  await setBadge(tabId, 'none');
  return { ok: /** @type {true} */ (true) };
}

/** @param {{ tabId: number, url?: string }} req */
export async function unroute({ tabId, url }) {
  await setBadge(tabId, 'none');
  // The same door every other departure takes. Behaviour is unchanged today; what changes is that
  // the rule "unfence before you navigate" is stated once instead of in every exit that grew its
  // own copy of it.
  if (url) await sendAway(tabId, url).catch(() => {});
  else await forgetTab(tabId);
  return { ok: /** @type {true} */ (true) };
}

/**
 * Sends a tab anywhere that is not the proxy, and takes its fence off on the way. The fence lets
 * nothing but the gateway through, so a tab still wearing one cannot even reach our own console:
 * the browser blocks the page and tells the reader an extension did it. Every navigation away from
 * the proxy goes through here for that reason; only `fence` navigates while a fence is standing,
 * and it navigates to the one address the fence allows.
 *
 * The badge is left to the caller, because a launch is busy at this moment and a cancel is not.
 *
 * @param {number} tabId @param {string} url
 */
export async function sendAway(tabId, url) {
  await clearTab(tabId);
  await forgetLabel(tabId);
  return chrome.tabs.update(tabId, { url });
}

/**
 * Retires the record when the tab is plainly no longer on the proxy.
 *
 * Leaving is not an event anybody can hear. The fence holds the page, so an address the person types
 * is simply allowed and nothing fires — which is the point, but it leaves the record of a routed tab
 * outliving the routing, and a panel offering to stop what already stopped.
 *
 * So this is not a watcher. It runs where somebody is already looking: the panel reads the tab's
 * address to draw itself, and an address that is plainly not ours is the evidence. An address we
 * cannot read is the ordinary case, because `activeTab` lapses the moment the tab navigates, and it
 * proves nothing — acting on it would unfence a tab that never went anywhere.
 *
 * Our own console is not evidence either, and this is the sharp edge. It is what the tab shows for
 * the whole of a launch, so a panel opened during one would retire the fence installed a moment
 * earlier and let the tab arrive at the proxy with nothing holding it. It is also somewhere a
 * proxied page can put the tab by itself, which would hand the page the timing.
 *
 * @param {number} tabId @param {string} [shownUrl]
 */
export async function forgetIfLeft(tabId, shownUrl) {
  if (!shownUrl || fromProxyUrl(shownUrl)) return;
  try {
    if (!/^https?:$/.test(new URL(shownUrl).protocol)) return;
  } catch {
    return;
  }
  if (isOurOwnConsole(shownUrl, await frontEndpoints())) return;
  if (!readTabRule(await sessionRules(), tabId)) return;
  await forgetTab(tabId);
}

/** Chrome reuses tab ids, so a closed tab must leave no rules behind. @param {number} tabId */
export async function forgetTab(tabId) {
  await clearTab(tabId);
  await forgetLabel(tabId);
  await setBadge(tabId, 'none');
}

/** For the options page. */
export async function routedTabs() {
  const installed = await sessionRules();
  const named = await labels();
  const tabs = await chrome.tabs.query({});
  return tabs.flatMap((t) => {
    const rule = t.id === undefined ? null : readTabRule(installed, t.id);
    return rule ? [{ tabId: t.id, origin: named[String(t.id)] ?? '' }] : [];
  });
}
