/** Settings, and what is routed right now. */

import { Message, send } from './messaging.js';
import { readSettings, writeSettings } from './config.js';
import { fillHomeButton, fillSiteLinks } from './site-links.js';

/** @param {string} key @param {...string} subs */
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.length ? subs : undefined);
/** @param {string} id @returns {any} */
const el = (id) => document.getElementById(id);

const STATIC_TEXT = {
  title: 'optionsTitle', routedHeading: 'optionsRoutedHeading', routedEmpty: 'optionsRoutedEmpty',
  routedEmptyHint: 'optionsRoutedEmptyHint',
  autoRecoverLabel: 'optionsAutoRecoverLabel', autoRecoverHelp: 'optionsAutoRecoverHelp',
  autoRecoverPermission: 'optionsAutoRecoverPermission',
  save: 'optionsSave',
  // The same facts the popup shows once on first use. Shown once and never again is not a
  // disclosure, so they live here permanently as well.
  tradeHeading: 'popupFirstRunTradeHeading', tradeServers: 'popupFirstRunTradeServers',
  tradeAddress: 'popupFirstRunTradeAddress', tradeCookies: 'popupFirstRunTradeCookies',
  tradeRequest: 'popupFirstRunTradeRequest',
};

// Screen readers pronounce by the document language, and every string here comes from the catalog.
document.documentElement.lang = chrome.i18n.getUILanguage();


/** @type {ReturnType<typeof setTimeout>|undefined} */
let savedTimer;

/** @param {string} message @param {boolean} [isError] */
function say(message, isError = false) {
  const node = el('saved');
  clearTimeout(savedTimer);
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.hidden = false;
  node.setAttribute('role', isError ? 'alert' : 'status');
  requestAnimationFrame(() => node.classList.remove('leaving'));
  // A confirmation that never leaves stops meaning anything, but it holds long enough to be read.
  savedTimer = setTimeout(() => {
    node.classList.add('leaving');
    savedTimer = setTimeout(() => { node.hidden = true; }, 180);
  }, 4000);
}

/** @param {string} label @param {string} actionLabel @param {() => void} onClick */
const row = (label, actionLabel, onClick) => {
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.className = 'grow host';
  name.textContent = label;
  const button = document.createElement('button');
  button.className = 'ghost';
  button.textContent = actionLabel;
  button.setAttribute('aria-label', `${actionLabel}: ${label}`);
  button.addEventListener('click', onClick);
  li.append(name, button);
  return li;
};

async function renderRouted() {
  const tabs = await send(Message.routedTabs);
  el('routed').replaceChildren(...tabs.map((/** @type {{tabId: number, origin: string}} */ r) => row(
    r.origin ? new URL(r.origin).host : t('optionsRoutedUnknown'),
    t('optionsTakeOut'),
    async () => { await send(Message.unroute, { tabId: r.tabId, url: r.origin }); void renderRouted(); },
  )));
  el('routedEmptyWrap').hidden = tabs.length > 0;
}

/** What is on disk, so the form can tell whether it still matches. */
let stored = false;

function syncSave() {
  const dirty = el('autoRecover').checked !== stored;
  el('save').setAttribute('aria-disabled', String(!dirty));
}

async function renderSettings() {
  stored = (await readSettings()).autoRecover;
  el('autoRecover').checked = stored;
  syncSave();
}

el('autoRecover').addEventListener('change', syncSave);

el('form').addEventListener('submit', async (/** @type {Event} */ event) => {
  event.preventDefault();
  if (el('save').getAttribute('aria-disabled') === 'true') return;
  const autoRecover = el('autoRecover').checked;
  const held = await chrome.permissions.getAll();

  // The click on Save is the gesture that authorises this, so it happens here and nowhere else.
  if (autoRecover && !held.permissions?.includes('webNavigation')
      && !(await chrome.permissions.request({ permissions: ['webNavigation'] }))) {
    await renderSettings();
    say(t('optionsAccessDenied'), true);
    return;
  }

  await writeSettings({ autoRecover });
  stored = autoRecover;
  syncSave();
  say(t('optionsSaved'));
});

// Element by element: one stale id would otherwise throw and blank the whole page.
for (const [id, key] of Object.entries(STATIC_TEXT)) {
  const node = el(id);
  if (node) node.textContent = t(key);
}
el('version').textContent = t('optionsVersion', chrome.runtime.getManifest().version);
void fillHomeButton();
void fillSiteLinks();
void renderRouted();
void renderSettings();
