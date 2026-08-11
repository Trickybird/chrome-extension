/** Entry point. Registers browser events and delegates; decides nothing. */

import { Message, serve } from './messaging.js';
import { forgetTab, routedTabs, stateOf, unroute } from './router.js';
import { cancelLaunch, forgetLaunches, serveHandoff, startLaunch, sweepExpired } from './handoff.js';
import { dropPendingForTab } from './pending.js';
import { frontEndpoints, isOurOwnConsole, refreshCatalog } from './fronts.js';
import { drop, get, put } from './offers.js';
import { readSettings } from './config.js';
import { clearedByLoad, isOfferable } from './recovery.js';
import { toFailure } from './errors.js';

const MENU_ID = 'route';

serve({
  [Message.tabState]: async ({ tabId, url }) => {
    // Before the state is read rather than after: an expired launch becomes something the panel can
    // act on, and the panel is asking this question on its way to drawing itself.
    await sweepExpired(tabId);
    return stateOf(tabId, url);
  },
  [Message.launch]: (msg) => startLaunch(msg),
  [Message.cancelLaunch]: (msg) => cancelLaunch(msg),
  [Message.unroute]: (msg) => unroute(msg),
  [Message.routedTabs]: () => routedTabs(),
  [Message.takeOffer]: async ({ tabId }) => {
    const offer = await get(tabId);
    if (offer) await drop(tabId);
    return offer;
  },
  [Message.dismissOffer]: ({ tabId }) => drop(tabId),
}, toFailure);

serveHandoff();

chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetTab(tabId);
  void drop(tabId);
  void dropPendingForTab(tabId).then((nonces) => forgetLaunches(tabId, nonces));
});

/*
 * The address list is fetched while the network still works, not when it stops. By the time our
 * shipped address is blocked the extension is already holding the others, and by event rather than
 * on a timer: a background poll is a shape in the traffic and buys nothing an event does not.
 */
chrome.runtime.onStartup.addListener(() => void refreshCatalog().catch(() => {}));

chrome.runtime.onInstalled.addListener(async () => {
  void refreshCatalog().catch(() => {});
  // An update leaves a second copy of the entry behind.
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: chrome.i18n.getMessage('menuRoute'),
    contexts: ['page', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id;
  // The click grants activeTab, so tab.url is there even when the menu reports neither address.
  const url = info.linkUrl ?? info.pageUrl ?? tab?.url;
  if (tabId === undefined || !url) return;
  // Nothing to ask for, so this goes straight through. A failure here is ours, not the browser's,
  // so it carries its code instead of being dressed up as a page that would not load. On a link the
  // tab is not on that address, so where to put it back is passed separately.
  await startLaunch({ tabId, url, originalUrl: info.pageUrl ?? tab?.url })
    .catch((e) => put(tabId, url, 'error', e?.code));
});

/** @param {{ tabId: number, url: string, error: string, frameId: number }} details */
async function onNavigationFailed(details) {
  if (!isOfferable(details)) return;
  const { autoRecover } = await readSettings();
  if (autoRecover) await put(details.tabId, details.url, 'failed');
}

/** @param {{ tabId: number, frameId: number, url?: string }} details */
const onNavigationDone = async ({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  const offer = await get(tabId);
  // The address list is only worth reading when the tab holds a failure that could outlive the load.
  const parked = offer?.reason === 'error' && isOurOwnConsole(url ?? '', await frontEndpoints());
  if (!clearedByLoad(offer, parked)) return;
  void drop(tabId);
};

/** The namespace exists only once the optional permission is granted. */
function watchNavigation() {
  if (!chrome.webNavigation) return;
  if (!chrome.webNavigation.onErrorOccurred.hasListener(onNavigationFailed)) {
    chrome.webNavigation.onErrorOccurred.addListener(onNavigationFailed);
    chrome.webNavigation.onCompleted.addListener(onNavigationDone);
  }
}

watchNavigation();
chrome.permissions.onAdded.addListener(watchNavigation);
