/** The links every surface carries. They follow the configured address, so a mirror keeps its own. */

import { readSettings, siteLink } from './config.js';

const PAGES = [
  { id: 'support', path: '/support', key: 'footerSupport' },
  { id: 'terms', path: '/terms', key: 'footerTerms' },
  // Required by the store once a product handles user data, and this one sends every
  // address you open to our servers.
  { id: 'privacy', path: '/privacy', key: 'footerPrivacy' },
  // When something will not open, the first useful question is whether it is us or them.
  { id: 'statusLink', path: '/status', key: 'footerStatus' },
];

/**
 * The button that goes to the site itself. Its path is the root, so it is not one of the PAGES,
 * whose entries are all named pages.
 */
export async function fillHomeButton() {
  const node = /** @type {HTMLAnchorElement|null} */ (document.getElementById('home'));
  if (!node) return;
  const { endpoints } = await readSettings();
  node.href = siteLink(endpoints, '/');
  // The same action the launcher screen offers, so it carries the same label.
  const label = chrome.i18n.getMessage('popupLaunchAction');
  node.title = label;
  node.setAttribute('aria-label', label);
}

export async function fillSiteLinks() {
  const { endpoints } = await readSettings();
  for (const { id, path, key } of PAGES) {
    const node = /** @type {HTMLAnchorElement|null} */ (document.getElementById(id));
    if (!node) continue;
    node.textContent = chrome.i18n.getMessage(key);
    node.href = siteLink(endpoints, path);
  }
}
