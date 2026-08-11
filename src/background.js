/** Entry point. Registers browser events and delegates; decides nothing. */

import { Message, serve } from './messaging.js';
import { forgetTab, route, routedTabs, stateOf, unroute } from './router.js';
import { drop, get, put } from './offers.js';
import { readSettings } from './config.js';
import { isOfferable } from './recovery.js';
import { toFailure } from './errors.js';

const MENU_ID = 'route';

serve({
  [Message.tabState]: ({ tabId, url }) => stateOf(tabId, url),
  [Message.route]: (msg) => route(msg),
  [Message.unroute]: (msg) => unroute(msg),
  [Message.routedTabs]: () => routedTabs(),
  [Message.takeOffer]: async ({ tabId }) => {
    const offer = await get(tabId);
    if (offer) await drop(tabId);
    return offer;
  },
  [Message.dismissOffer]: ({ tabId }) => drop(tabId),
}, toFailure);

chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetTab(tabId);
  void drop(tabId);
});

chrome.runtime.onInstalled.addListener(async () => {
  // An update would otherwise leave a second copy of the entry behind.
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
  // so it carries its code instead of being dressed up as a page that would not load.
  await route({ tabId, url }).catch((e) => put(tabId, url, 'error', e?.code));
});

/** @param {{ tabId: number, url: string, error: string, frameId: number }} details */
async function onNavigationFailed(details) {
  if (!isOfferable(details)) return;
  const { autoRecover } = await readSettings();
  if (autoRecover) await put(details.tabId, details.url, 'failed');
}

/** @param {{ tabId: number, frameId: number }} details */
const onNavigationDone = ({ tabId, frameId }) => {
  if (frameId === 0) void drop(tabId);
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
