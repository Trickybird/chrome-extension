/**
 * The toolbar badge, with a single owner. It is the only voice when no popup is open: the
 * right-click menu opens none, and a route can fail after the popup closes.
 *
 * `…` is a request in flight, `!` is something the popup has to say. No counter: a number reads as
 * unread notifications, which neither state is.
 */

/** @typedef {'busy'|'attention'|'none'} Badge */

// Literal colours rather than the CSS tokens: this is browser chrome, outside any page, and a
// worker has no live read of the theme to pick a variant by.
const LOOK = {
  busy: { text: '…', color: '#5b4bf2', title: 'badgeBusy' },
  attention: { text: '!', color: '#b91c1c', title: 'badgeAttention' },
  none: { text: '', color: '#00000000', title: 'extName' },
};

/** A tab can close between the event and the badge, so its absence is not a failure. */
const quietly = (/** @type {Promise<unknown>} */ p) => p.catch(() => {});

/** @param {number} tabId @param {Badge} kind */
export async function setBadge(tabId, kind) {
  const { text, color, title } = LOOK[kind];
  await quietly(chrome.action.setBadgeBackgroundColor({ tabId, color }));
  await quietly(chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }));
  await quietly(chrome.action.setBadgeText({ tabId, text }));
  await quietly(chrome.action.setTitle({ tabId, title: chrome.i18n.getMessage(title) }));
}
