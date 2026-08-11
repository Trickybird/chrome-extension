/** Routes and unroutes a tab. The only module that touches rules or navigates. */

import { allocateBaseId, buildTabRules, readTabRule, ruleIdsForBase } from './rules.js';
import { setBadge } from './badge.js';
import { targetFragment, ticketFragment } from './fragment.js';
import { classify, NotRoutable } from './target.js';
import { fromProxyUrl } from './proxy-url.js';
import { normalize, preferred } from './endpoints.js';
import { openPending, pendingForTab } from './pending.js';
import { EXTENSION_BUILD, sessionOrigins } from './config.js';
import { canAnswerUs, firstReachable, frontEndpoints } from './fronts.js';
import { ErrorCode, RoutingError } from './errors.js';

const sessionRules = () => chrome.declarativeNetRequest.getSessionRules();

/**
 * The site's name, kept beside the rules because Chrome will not tell the background what a tab is
 * showing. The rules stay the truth; this is a caption, so on disagreement it goes blank, not wrong.
 */
const LABELS = 'routedOrigins';

/** @returns {Promise<Record<string, string>>} */
const labels = async () => /** @type {Record<string, string>} */ (
  (await chrome.storage.session.get(LABELS))[LABELS] ?? {});

/** @param {number} tabId @param {string} origin */
async function label(tabId, origin) {
  await chrome.storage.session.set({ [LABELS]: { ...(await labels()), [String(tabId)]: origin } });
}

/** @param {number} tabId */
async function forgetLabel(tabId) {
  const rest = await labels();
  if (!rest[String(tabId)]) return;
  delete rest[String(tabId)];
  await chrome.storage.session.set({ [LABELS]: rest });
}

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
    if (originalUrl) await chrome.tabs.update(tabId, { url: originalUrl }).catch(() => {});
    await setBadge(tabId, 'attention');
    throw new RoutingError(ErrorCode.ENDPOINT_UNREACHABLE, `tried ${tried.length}`);
  }
  const endpoint = await firstReachable(ordered);
  const [origin] = sessionOrigins([endpoint]);

  await setBadge(tabId, 'busy');
  let nonce;
  if (canAnswerUs(origin)) {
    nonce = await openPending({
      url, targetOrigin: target.origin, tabId, originalUrl: originalUrl ?? url, tried, endpoint,
    });
  }
  // Either way the destination is in the fragment, which no server ever sees. The nonce says nothing
  // even to the page that reads it; the address says what the person asked for and nothing more.
  const fragment = nonce ? ticketFragment(nonce) : targetFragment(encodeTarget(url));

  await chrome.tabs.update(tabId, { url: `${origin}/?ext=${EXTENSION_BUILD}${fragment}` }).catch(() => {
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
  await clearTab(tabId);
  const baseId = allocateBaseId(await sessionRules());
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: buildTabRules({ tabId, origin: targetOrigin, endpoint, baseId }),
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
  await forgetTab(tabId);
  if (url) await chrome.tabs.update(tabId, { url }).catch(() => {});
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
