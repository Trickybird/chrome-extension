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

/** @param {string} id */
const el = (id) => /** @type {HTMLAnchorElement|null} */ (document.getElementById(id));

/**
 * Every link on the surface, from one read of the settings. Both surfaces want all of them, and
 * asking storage once per link is a round trip each time the popup opens.
 */
export async function fillSiteLinks() {
  const { endpoints } = await readSettings();

  for (const { id, path, key } of PAGES) {
    const node = el(id);
    if (!node) continue;
    node.textContent = chrome.i18n.getMessage(key);
    node.href = siteLink(endpoints, path);
  }

  // The way to the site itself, and an icon button rather than a named page: its label is the
  // accessible name, because writing text into it would replace the glyph.
  const home = el('home');
  if (!home) return;
  home.href = siteLink(endpoints, '/');
  // The same action the launcher screen offers, so it carries the same label.
  const label = chrome.i18n.getMessage('popupLaunchAction');
  home.title = label;
  home.setAttribute('aria-label', label);
}
