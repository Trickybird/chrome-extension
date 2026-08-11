/** Settings, and what is routed right now. */

import { Message, send } from './messaging.js';
import { readSettings, writeSettings } from './config.js';
import { fillSiteLinks } from './site-links.js';

/** @param {string} key @param {...string} subs */
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.length ? subs : undefined);
/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** A field, where the surface needs what was typed or ticked rather than what is drawn. */
const field = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

const STATIC_TEXT = {
  title: 'optionsTitle', routedHeading: 'optionsRoutedHeading', routedEmpty: 'optionsRoutedEmpty',
  routedEmptyHint: 'optionsRoutedEmptyHint',
  autoRecoverLabel: 'optionsAutoRecoverLabel', autoRecoverHelp: 'optionsAutoRecoverHelp',
  autoRecoverPermission: 'optionsAutoRecoverPermission',
  endpointLabel: 'optionsEndpointLabel', endpointHelp: 'optionsEndpointHelp',
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
let storedEndpoint = '';

/** The address as typed, trimmed, with the trailing slash a person naturally adds taken off. */
const typedEndpoint = () =>
  field('endpoint').value.trim().replace(/\/+$/, '');

function syncSave() {
  const dirty = field('autoRecover').checked !== stored
    || typedEndpoint() !== storedEndpoint;
  el('save').setAttribute('aria-disabled', String(!dirty));
}

async function renderSettings() {
  const settings = await readSettings();
  stored = settings.autoRecover;
  [storedEndpoint] = settings.endpoints;
  field('autoRecover').checked = stored;
  field('endpoint').value = storedEndpoint;
  syncSave();
}

el('autoRecover').addEventListener('change', syncSave);
el('endpoint').addEventListener('input', syncSave);

el('form').addEventListener('submit', async (/** @type {Event} */ event) => {
  event.preventDefault();
  if (el('save').getAttribute('aria-disabled') === 'true') return;
  const autoRecover = field('autoRecover').checked;
  const endpoint = typedEndpoint();
  // An address that is not https is refused here rather than stored and failed later: everything
  // downstream assumes it, and a person who typed http deserves to be told, not ignored.
  if (endpoint && !/^https:\/\/[^/\s]+$/.test(endpoint)) {
    say(t('optionsEndpointInvalid'), true);
    return;
  }
  // The click on Save is the gesture that authorises this, so it happens here and before any other
  // await: a permission already held comes back true with no dialog, so there is nothing to look up
  // first, and looking it up is what puts a round trip between the click and the ask.
  if (autoRecover) {
    if (!(await chrome.permissions.request({ permissions: ['webNavigation'] }))) {
      await renderSettings();
      say(t('optionsAccessDenied'), true);
      return;
    }
  } else {
    // Handed back rather than kept. Nothing reads it once the offer is off, and a browser still
    // listing a permission against us for a switch nobody uses is a claim we would rather not make.
    await chrome.permissions.remove({ permissions: ['webNavigation'] }).catch(() => {});
  }

  await writeSettings({ autoRecover, endpoints: endpoint ? [endpoint] : [] });
  stored = autoRecover;
  await renderSettings();
  say(t('optionsSaved'));
});

// Element by element: one stale id throws and blanks the whole page.
for (const [id, key] of Object.entries(STATIC_TEXT)) {
  const node = el(id);
  if (node) node.textContent = t(key);
}
el('version').textContent = t('optionsVersion', chrome.runtime.getManifest().version);
void fillSiteLinks();
void renderRouted();
void renderSettings();
