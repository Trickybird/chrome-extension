/** Routes and unroutes a tab. The only module that touches rules or navigates. */

import { allocateBaseId, buildTabRules, readTabRule, ruleIdsForBase } from './rules.js';
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
 * Removes one tab's fence and nothing else. Clearing every rule would un-fence a tab that is still
 * showing a proxied page, silently and with nothing left to stop it reaching anywhere.
 * @param {number} tabId
 */
async function clearTab(tabId) {
  const rule = readTabRule(await sessionRules(), tabId);
  if (rule) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: ruleIdsForBase(rule.baseId),
    });
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
  // Read here rather than in `buildTabRules`, which is pure and cannot await: the fence has to name
  // the addresses this install would open, so the page's own way home is never the thing we block.
  const consoleHosts = sessionOrigins(await frontEndpoints()).map((o) => new URL(o).hostname);
  await clearTab(tabId);
  const baseId = allocateBaseId(await sessionRules());
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: buildTabRules({ tabId, origin: targetOrigin, endpoint, consoleHosts, baseId }),
    });
  } catch (e) {
    throw new RoutingError(ErrorCode.NO_SESSION, String(e));
  }

  const installed = readTabRule(await sessionRules(), tabId);
  if (!installed || installed.endpointHost !== new URL(endpoint).hostname) {
    await chrome.declarativeNetRequest
      .updateSessionRules({ removeRuleIds: ruleIdsForBase(baseId) }).catch(() => {});
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
 * The way out of a fence somebody walked into. They typed an address, the fence refused it, and the
 * page Chrome shows for that names an extension as the culprit and offers nothing further.
 *
 * The refusal stands: the request never left, and nothing here relaxes a rule. What changes is where
 * the tab ends up. It comes back to the console with the address already in the field, so one press
 * opens it through the proxy, and it loses its own fence on the way, because leaving was the point.
 * Every other fenced tab is untouched.
 *
 * @param {{ tabId: number, url: string }} req
 */
export async function leaveFence({ tabId, url }) {
  const endpoints = await frontEndpoints();
  // Where the tab is going is worked out while the fence is still up. Choosing an address means
  // probing one, which takes as long as the network does, and an unfenced tab still showing a
  // proxied page is a state to pass through rather than to sit in.
  const destination = isOurOwnConsole(url, endpoints)
    // Already one of ours, so it is the address itself that was refused, not a site to open. Sending
    // it through the field would offer to proxy our own console, and would drop the marker the page
    // uses to say what happened.
    ? url
    : consoleUrl(sessionOrigins([await firstReachable(await preferred(normalize(endpoints)))])[0],
      targetFragment(encodeTarget(url)));

  await sendAway(tabId, destination).catch(() => {});
  await setBadge(tabId, 'none');
  return { ok: /** @type {true} */ (true) };
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
