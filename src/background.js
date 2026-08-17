/** Entry point. Registers browser events and delegates; decides nothing. */

import { Message, serve } from './messaging.js';
import { forgetTab, leaveFence, routedTabs, stateOf, unroute } from './router.js';
import { cancelLaunch, forgetLaunches, serveHandoff, startLaunch, sweepExpired } from './handoff.js';
import { dropPendingForTab } from './pending.js';
import { frontEndpoints, isOurOwnConsole, refreshCatalog } from './fronts.js';
import { drop, get, put } from './offers.js';
import { readSettings } from './config.js';
import { clearedByLoad, isOfferable, isOurOwnBlock } from './recovery.js';
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
  // The routed panel does not read an offer, so this is how the badge it lit goes out.
  [Message.dropOffer]: ({ tabId }) => drop(tabId),
  [Message.takeOffer]: async ({ tabId }) => {
    const offer = await get(tabId);
    if (offer) await drop(tabId);
    return offer;
  },
}, toFailure);

serveHandoff();

/** Everything keyed to a tab id, let go at once. @param {number} tabId */
function forgetEverythingAbout(tabId) {
  void forgetTab(tabId);
  void drop(tabId);
  void dropPendingForTab(tabId).then((nonces) => forgetLaunches(tabId, nonces));
}

chrome.tabs.onRemoved.addListener(forgetEverythingAbout);

/*
 * The other way a tab ends. Chrome sends this instead of `onRemoved` when a tab is replaced, which
 * prerendering does and discarding may; the id it hands out afterwards is a different one, and this
 * codebase assumes everywhere that a dead id leaves nothing behind, because Chrome gives that id to
 * somebody else.
 *
 * Only the old id is cleaned. Moving the fence across would mean rebuilding it from what a rule
 * remembers, and a rule remembers the endpoint's host without its port, so the rebuilt fence could
 * name an address the tab never came from. A tab that comes back unfenced is the same state a
 * browser restart leaves, and it is answered where that one is.
 */
chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) =>
  forgetEverythingAbout(removedTabId));

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
  // Ours is the one refusal we can answer, and the only one worth answering without being asked: an
  // offer would put the address behind a second press, on a page that is telling the reader to
  // switch extensions off. The tab has to be one we fenced, because that code names no extension.
  if (isOurOwnBlock(details) && (await stateOf(details.tabId)).routed) {
    await leaveFence({ tabId: details.tabId, url: details.url });
    return;
  }
  if (!isOfferable(details)) return;
  const { autoRecover } = await readSettings();
  if (autoRecover) await put(details.tabId, details.url, 'failed');
}

/** @param {{ tabId: number, frameId: number, url?: string }} details */
const onNavigationDone = async ({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  const offer = await get(tabId);
  // With nothing held for this tab there is nothing to clear, and `drop` also puts the badge out.
  // A launch sets that badge to busy and then sends the tab to the console; the console finishing
  // its load used to land here and wipe the one thing saying the launch was waiting on a press.
  if (!offer) return;
  // Only the address list is the caller's business. Whether the offer survives a load is decided in
  // one place, and it is not this one.
  if (!clearedByLoad(offer, isOurOwnConsole(url ?? '', await frontEndpoints()))) return;
  void drop(tabId);
};

/**
 * The namespace exists only once the optional permission is granted, and one switch grants it. Two
 * independent behaviours hang off that: the offer to reopen a page that failed, and the way out of
 * a fence a person walked into. The settings page revokes it when the offer is switched off, which
 * takes the second one with it.
 */
function watchNavigation() {
  if (!chrome.webNavigation) return;
  // Each guarded on its own: revoking and granting again runs this a second time, and a guard that
  // covers only the first listener registers the second one twice.
  if (!chrome.webNavigation.onErrorOccurred.hasListener(onNavigationFailed)) {
    chrome.webNavigation.onErrorOccurred.addListener(onNavigationFailed);
  }
  if (!chrome.webNavigation.onCompleted.hasListener(onNavigationDone)) {
    chrome.webNavigation.onCompleted.addListener(onNavigationDone);
  }
}

watchNavigation();
chrome.permissions.onAdded.addListener(watchNavigation);
