/** Routes and unroutes a tab. The only module that touches rules or navigates. */

import { allocateBaseId, buildTabRules, readTabRule, ruleIdsForBase } from './rules.js';
import { setBadge } from './badge.js';
import { classify, NotRoutable } from './target.js';
import { fromProxyUrl } from './proxy-url.js';
import { normalize, preferred, remember } from './endpoints.js';
import { openSession } from './session.js';
import { readSettings } from './config.js';
import { ErrorCode, RoutingError } from './errors.js';

const sessionRules = () => chrome.declarativeNetRequest.getSessionRules();

/**
 * The site's name, kept beside the rules because Chrome will not tell the background what address
 * a tab is showing. The rules stay the truth about what is routed; this is only the label the
 * settings page prints, so if the two ever disagree the label goes blank rather than wrong.
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
 * Removes one tab's fence and nothing else. Clearing every rule used to be how a new route began,
 * which quietly un-fenced whatever tab was routed before: it kept showing a proxied page with
 * nothing left stopping it from reaching anywhere directly.
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
 * Rules installed is not the same as the tab actually showing a proxied page, and the caller
 * supplies the address because reading it here would need access to the proxy.
 *
 * @param {number} tabId
 * @param {string} [shownUrl]
 */
export async function stateOf(tabId, shownUrl) {
  const rule = readTabRule(await sessionRules(), tabId);
  if (!rule) return { routed: false };
  const shown = fromProxyUrl(shownUrl ?? '');
  return {
    routed: true,
    origin: shown?.origin ?? (await labels())[String(tabId)] ?? '',
    // null is "we could not read the address", which is not evidence of anything. Reading it as
    // false is what made a perfectly routed tab report that nothing came back.
    proven: shownUrl ? Boolean(shown && new URL(shown.endpoint).hostname === rule.endpointHost) : null,
  };
}

/**
 * @param {{ tabId: number, url: string }} req
 * @returns {Promise<{ ok: true, endpoint: string }>}
 */
export async function route({ tabId, url }) {
  const target = classify(url);
  if (!target.ok) {
    throw new RoutingError(ErrorCode.NOT_ROUTABLE, target.reason ?? NotRoutable.scheme);
  }

  // The badge is set from here, not from the popup, because this is the one place that knows the
  // outcome whether or not anyone is still listening.
  await setBadge(tabId, 'busy');
  try {
    const settings = await readSettings();
    const { bootstrapUrl, endpoint, via } = await openSession(
      await preferred(normalize(settings.endpoints)), url,
    );
    await remember(via);

    // The tab may have moved on while the session was being obtained.
    const still = await chrome.tabs.get(tabId).catch(() => null);
    if (!still) throw new RoutingError(ErrorCode.TAB_GONE, 'tab closed');

    await clearTab(tabId);
    const installed = await sessionRules();
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: buildTabRules({
          tabId, origin: target.origin, endpoint, baseId: allocateBaseId(installed),
        }),
      });
    } catch (e) {
      throw new RoutingError(ErrorCode.NO_SESSION, String(e));
    }
    await label(tabId, target.origin);

    await chrome.tabs.update(tabId, { url: bootstrapUrl }).catch(() => {
      throw new RoutingError(ErrorCode.TAB_GONE, 'tab closed');
    });
    await setBadge(tabId, 'none');
    return { ok: /** @type {true} */ (true), endpoint: new URL(endpoint).host };
  } catch (e) {
    await setBadge(tabId, 'attention');
    throw e;
  }
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
