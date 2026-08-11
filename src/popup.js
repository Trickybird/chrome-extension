/** The popup. Every state is read live at open time; there is no stored connected flag. */

import { Message, send } from './messaging.js';
import { classify } from './target.js';
import { fromProxyUrl } from './proxy-url.js';
import { fillHomeButton, fillSiteLinks } from './site-links.js';
import { readSettings, siteLink } from './config.js';
import { ErrorCode, MESSAGE_KEY } from './errors.js';

/** @param {string} key @param {...string} subs */
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.length ? subs : undefined);
/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @typedef {{ label: string, disabled?: boolean, danger?: boolean, onClick?: () => void }} Action */
/**
 * @typedef {object} View
 * @property {string} [heading]
 * @property {string} [address]
 * @property {string|null} [state]
 * @property {string} [body]
 * @property {boolean} [trade]
 * @property {string} [failure]
 * @property {Action|null} [primary]
 * @property {Action|null} [secondary]
 * @property {string} [helper]
 */
/** @typedef {{ ok: true, origin: string, host: string }} Routable */
/** @typedef {{ url: string, reason: 'link'|'failed'|'error', code?: string }} Offer */

const view = {
  heading: el('heading'), address: el('artAddress'), status: el('status'),
  home: /** @type {HTMLAnchorElement} */ (el('home')),
  body: el('body'),
  trade: el('trade'), tradeHeading: el('tradeHeading'), tradeServers: el('tradeServers'),
  tradeAddress: el('tradeAddress'), tradeCookies: el('tradeCookies'),
  tradeRequest: el('tradeRequest'),
  failure: el('failure'), primary: /** @type {HTMLButtonElement} */ (el('primary')),
  secondary: /** @type {HTMLButtonElement} */ (el('secondary')), helper: el('helper'),
  manage: el('manage'),
};

const FIRST_RUN_SEEN = 'firstRunSeen';
/** Whether the long first-run explanation was on screen this time, which is what the flag gates. */
let firstRunShown = false;
const ADDRESS_CHARS = 32;
// Six seconds for a page that is slow, checked often enough that the payoff is not held back.
const SETTLE_TRIES = 60;
const SETTLE_STEP = 100;

/** @type {Record<string, { heading: string, body: string }>} */
const OFFER_TEXT = {
  link: { heading: 'popupOfferLinkHeading', body: 'popupOfferLinkBody' },
  failed: { heading: 'popupOfferFailedHeading', body: 'popupOfferFailedBody' },
};

/** Longest address the drawn bar holds before its own edge cuts it. @param {string} address */
const fit = (address) => (address.length > ADDRESS_CHARS ? `${address.slice(0, ADDRESS_CHARS - 1)}…` : address);

/**
 * One writer for the whole panel; no state leaves a stale element behind.
 * @param {View} v
 */
function render({ heading = '', address = '', state = null, body = '',
  trade = false, failure = '', primary = null, secondary = null, helper = '' } = {}) {
  view.heading.textContent = heading;
  view.heading.hidden = !heading;
  view.body.hidden = !body;
  view.address.textContent = fit(address);
  view.status.hidden = !state;
  view.status.setAttribute('aria-label', address);
  // One state on one element: the heading and the drawing both dress from it.
  document.body.dataset.state = state ?? '';
  view.body.textContent = body;
  view.trade.hidden = !trade;
  view.failure.hidden = !failure;
  view.failure.textContent = failure;
  view.helper.textContent = helper;
  view.helper.hidden = !helper;
  for (const [node, spec] of /** @type {[HTMLButtonElement, Action|null][]} */ ([
    [view.primary, primary], [view.secondary, secondary],
  ])) {
    node.hidden = !spec;
    if (spec) {
      node.textContent = spec.label;
      // aria-disabled rather than disabled: a disabled element loses focus, so the keyboard user
      // who just pressed this button would be dropped onto the document mid-request.
      node.classList.toggle('danger', Boolean(spec.danger));
      node.setAttribute('aria-disabled', String(Boolean(spec.disabled)));
      node.toggleAttribute('aria-busy', Boolean(spec.disabled));
      node.onclick = spec.disabled ? null : (spec.onClick ?? null);
    }
  }
  // Not onto the other button: landing on "stop" would put the exit under the next Space press.
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.hidden) view.heading.focus({ preventScroll: true });
}

// Screen readers pronounce by the document language, and every string here comes from the catalog.
document.documentElement.lang = chrome.i18n.getUILanguage();

async function main() {
  // An icon button, so the label is the accessible name rather than its contents: writing text
  // into it would replace the glyph.
  void fillHomeButton();
  view.manage.setAttribute('aria-label', t('popupFooterManage'));
  view.manage.title = t('popupFooterManage');
  view.manage.onclick = () => chrome.runtime.openOptionsPage();
  view.tradeHeading.textContent = t('popupFirstRunTradeHeading');
  view.tradeServers.textContent = t('popupFirstRunTradeServers');
  view.tradeAddress.textContent = t('popupFirstRunTradeAddress');
  view.tradeCookies.textContent = t('popupFirstRunTradeCookies');
  view.tradeRequest.textContent = t('popupFirstRunTradeRequest');
  void fillSiteLinks();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return renderLauncher();

  const state = await send(Message.tabState, { tabId: tab.id, url: tab.url });
  if (state?.routed) return renderRouted(tab, state);

  // Taking it here is what marks it seen; the badge means nobody has looked yet.
  const offer = /** @type {Offer|null} */ (await send(Message.takeOffer, { tabId: tab.id }));
  const target = classify(offer?.url ?? tab.url);
  if (!target.ok) return renderLauncher();
  // Our own failure keeps its code and its screen; only a page the browser could not load is an offer.
  if (offer?.reason === 'error') return fail(offer.code ?? ErrorCode.NO_SESSION, tab, target);
  return offer ? renderOffer(tab, target, offer) : renderIdle(tab, target);
}

/**
 * Nothing on this page can be opened, which is still not a dead end: the site takes an address and
 * this popup does not have to grow a second way of asking for one.
 */
async function renderLauncher() {
  const { endpoints } = await readSettings();
  const url = siteLink(endpoints, '/');
  render({
    heading: t('popupLaunchHeading'),
    body: t('popupLaunchBody'),
    primary: {
      label: t('popupLaunchAction'),
      onClick: () => { void chrome.tabs.create({ url }); window.close(); },
    },
    helper: t('popupLaunchHelper'),
  });
}

/** @param {chrome.tabs.Tab} tab @param {Routable} target */
async function renderIdle(tab, target) {
  const { [FIRST_RUN_SEEN]: seen } = await chrome.storage.local.get(FIRST_RUN_SEEN);
  firstRunShown = !seen;
  render({
    // First sight gets the offer, because that is the news. After that the state is.
    heading: seen ? t('popupIdleState') : t('popupFirstRunHeading'),
    address: target.host,
    state: 'direct',
    body: seen ? '' : t('popupFirstRunBody'),
    trade: true,
    primary: { label: t('popupIdleAction'), onClick: () => start(tab, target) },
    helper: t('popupIdleHelper'),
  });
}

/** @param {chrome.tabs.Tab} tab @param {Routable} target @param {Offer} offer */
function renderOffer(tab, target, offer) {
  const text = OFFER_TEXT[offer.reason] ?? OFFER_TEXT.link;
  render({
    heading: t(text.heading),
    address: target.host,
    state: 'direct',
    body: t(text.body, target.host),
    trade: true,
    primary: { label: t('popupOfferAction'), onClick: () => start(tab, target, offer.url) },
    secondary: { label: t('popupOfferSecondary'), onClick: () => window.close() },
    helper: t('popupIdleHelper'),
  });
}

/** @param {chrome.tabs.Tab} tab @param {{ origin: string, proven: boolean|null }} state */
function renderRouted(tab, state) {
  // Only a tab we can positively see somewhere else is stale. Not being able to read the address
  // proves nothing, and the fence is installed either way.
  const proven = state.proven !== false;
  // Back to the page they were reading, not the site's front door.
  const shown = fromProxyUrl(tab.url ?? '');
  const exitTo = shown ? `${shown.origin}${shown.path}` : state.origin;
  render({
    heading: proven ? t('popupRoutedStatus') : t('popupStaleHeading'),
    address: state.origin ? new URL(state.origin).host : '',
    state: proven ? 'routed' : 'stale',
    body: proven ? '' : t('popupStaleBody'),
    trade: true,
    primary: proven ? null : { label: t('popupStaleAction'), onClick: () => retry(tab, state.origin) },
    secondary: {
      label: t('popupRoutedAction'),
      // Undoing the thing the panel is currently celebrating: the one action here worth a warning colour.
      danger: true,
      onClick: async () => {
        await send(Message.unroute, { tabId: tab.id, url: exitTo });
        window.close();
      },
    },
    helper: proven ? t('popupRoutedHelper') : '',
  });
}

/** @param {chrome.tabs.Tab} tab @param {string} origin */
function retry(tab, origin) {
  const target = classify(origin);
  if (target.ok) void start(tab, target);
}

/** @param {chrome.tabs.Tab} tab @param {Routable} target @param {string} [url] */
async function start(tab, target, url) {
  const explanationWasRead = firstRunShown;
  // Read before render() overwrites the nodes. The panel keeps its furniture through the wait;
  // dropping it resized the popup twice per route, the first time mid-click.
  const keep = {
    body: view.body.hidden ? '' : (view.body.textContent ?? ''),
    trade: !view.trade.hidden,
    helper: view.helper.hidden ? '' : (view.helper.textContent ?? ''),
  };
  render({
    heading: t('popupConnectingStatus'), address: target.host, state: 'connecting',
    ...keep,
    primary: { label: t('popupIdleAction'), disabled: true },
  });
  if (explanationWasRead) await chrome.storage.local.set({ [FIRST_RUN_SEEN]: true });

  const result = await send(Message.route, { tabId: tab.id, url: url ?? tab.url });
  if (!result?.ok) return fail(result?.code ?? ErrorCode.NO_SESSION, tab, target);
  return settle(tab, target);
}

/**
 * Holds the connecting panel until the proxied page has finished loading, then reports what the tab
 * is doing. `status` needs no permission, which is what makes waiting for it honest here.
 * @param {chrome.tabs.Tab} tab @param {Routable} target
 */
async function settle(tab, target) {
  let fresh = null;
  for (let attempt = 0; attempt < SETTLE_TRIES; attempt += 1) {
    fresh = await chrome.tabs.get(/** @type {number} */ (tab.id)).catch(() => null);
    if (!fresh || fresh.status === 'complete') break;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_STEP));
  }
  if (!fresh) return;
  const state = await send(Message.tabState, { tabId: tab.id, url: fresh.url });
  if (state?.routed) return renderRouted(fresh, state);
  return fail(ErrorCode.NO_SESSION, tab, target);
}

/** @param {string} code @param {chrome.tabs.Tab} tab @param {Routable} target */
function fail(code, tab, target) {
  const keys = MESSAGE_KEY[code];
  render({
    heading: t('popupFailedHeading'), address: target.host, state: 'failed',
    body: t(keys?.body ?? 'errNoSessionBody'),
    failure: t('popupFailedCode', code),
    primary: { label: t('popupFailedAction'), onClick: () => start(tab, target) },
    secondary: {
      label: t('popupFailedSecondary'),
      onClick: async () => {
        await navigator.clipboard.writeText(`${code} ${target.host} ${chrome.runtime.getManifest().version}`);
        // Into the code line, not the helper: the helper holds the only guidance on this screen.
        view.failure.textContent = t('popupFailedCopied');
      },
    },
    helper: t(keys?.helper ?? 'errNoSessionHelper'),
  });
}

void main();
