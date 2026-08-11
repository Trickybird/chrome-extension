/**
 * The console's side of a launch.
 *
 * The extension parks the address and sends the tab to the console; the console asks what the nonce
 * stands for, opens a session the way any visitor does, and hands the result back. Nothing here
 * trusts the sender: the channel is open to every script on that origin, so a reply is only acted on
 * when it names a live nonce and carries a bootstrap for the very address the person asked for.
 */

import { sessionOrigins } from './config.js';
import { frontEndpoints, refreshCatalog } from './fronts.js';
import { remember } from './endpoints.js';
import { verifyBootstrap } from './bootstrap-url.js';
import { markProbed, pendingForTab, readPending, takeExpiredForTab, takePending } from './pending.js';
import { fence, launch } from './router.js';
import { put } from './offers.js';
import { setBadge } from './badge.js';
import { ErrorCode } from './errors.js';
import { HANDOFF_CANCELLED, HANDOFF_VERSION, serveExternal } from './messaging.js';

// A page load plus a cold service worker. Past this the console is treated as not having answered.
// The timer is the worker's and dies with it, which is survivable rather than correct: a launch
// nobody answered for then waits out its record instead, and the sweep turns that into a retry.
export const PROBE_TIMEOUT_MS = 8000;

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const watchdogs = new Map();

/** @param {string} nonce */
function disarm(nonce) {
  const timer = watchdogs.get(nonce);
  if (timer !== undefined) clearTimeout(timer);
  watchdogs.delete(nonce);
}

/** @param {string} nonce */
function arm(nonce) {
  disarm(nonce);
  watchdogs.set(nonce, setTimeout(() => void onSilence(nonce), PROBE_TIMEOUT_MS));
}

/**
 * Nothing came back from that console. Try the next configured address; past the last one the tab
 * goes home and the badge carries the code.
 * @param {string} nonce
 */
async function onSilence(nonce) {
  watchdogs.delete(nonce);
  const record = await takePending(nonce);
  if (!record || record.probed) return;
  try {
    const next = (await launch({
      tabId: record.tabId,
      url: record.url,
      originalUrl: record.originalUrl,
      tried: [...record.tried, record.endpoint],
    })).nonce;
    // A mirror gets no nonce, because it cannot answer; there is then nothing to wait for.
    if (next) arm(next);
  } catch (e) {
    await put(record.tabId, record.url, 'error',
      /** @type {any} */ (e)?.code ?? ErrorCode.ENDPOINT_UNREACHABLE);
    // Nothing we know of answered, which is exactly when a newer list is worth asking for.
    void refreshCatalog().catch(() => {});
  }
}

/**
 * A launch nobody finished. It dies of old age with nothing to announce it, so the sweep runs where
 * somebody is looking: the record is the last thing holding the address they asked for, and that is
 * worth more as an offer to try again than as a record that quietly stopped existing.
 *
 * @param {number} tabId
 */
export async function sweepExpired(tabId) {
  const stale = await takeExpiredForTab(tabId);
  if (!stale) return;
  disarm(stale.nonce);
  await put(tabId, stale.url, 'error', ErrorCode.LAUNCH_EXPIRED);
}

/**
 * Opens a launch and starts watching for the console to answer.
 * @param {{ tabId: number, url: string, originalUrl?: string }} req
 */
export async function startLaunch(req) {
  const { nonce } = await launch(req);
  // Only an address that can answer gets watched. A mirror carries the destination in its own URL
  // and has nothing to say back, so there is nothing to time out.
  if (nonce) arm(nonce);
  return { ok: /** @type {true} */ (true) };
}

/**
 * Gives up on a launch and puts the tab back where it started. The person is looking at our site
 * waiting to press a button they have decided not to press, and the only address that can undo that
 * is the one this launch recorded.
 *
 * @param {{ tabId: number }} req
 */
export async function cancelLaunch({ tabId }) {
  const record = await pendingForTab(tabId);
  if (!record) return { ok: /** @type {true} */ (true) };
  disarm(record.nonce);
  await takePending(record.nonce);
  await setBadge(tabId, 'none');
  await chrome.tabs.update(tabId, { url: record.originalUrl }).catch(() => {});
  return { ok: /** @type {true} */ (true) };
}

/** @param {number} tabId @param {string[]} nonces */
export function forgetLaunches(tabId, nonces) {
  for (const nonce of nonces) disarm(nonce);
}

/**
 * Who is allowed to be heard, and about what. Returns the record only when the sender is one of our
 * consoles, the nonce is live, and the tab it names is the tab we sent.
 *
 * The origin test is deliberately not the manifest's list, which Chrome has already enforced by the
 * time a message arrives here. It is the narrower one: the addresses this install is configured to
 * open. Both have to hold, and collapsing them into one would drop whichever is stricter.
 *
 * @param {any} msg @param {chrome.runtime.MessageSender} sender
 */
async function authorize(msg, sender) {
  const origins = sessionOrigins(await frontEndpoints());
  if (!sender?.origin || !origins.includes(sender.origin)) return null;
  const nonce = typeof msg?.nonce === 'string' ? msg.nonce : '';
  const record = nonce ? await readPending(nonce) : null;
  if (!record) return null;
  // Chrome fills `tab` for a page sender; where it does, it has to be the one we navigated.
  if (sender.tab && sender.tab.id !== record.tabId) return null;
  return record;
}

export function serveHandoff() {
  serveExternal(HANDOFF_VERSION, {
    /** The console arrived and wants the address this nonce stands for. */
    pending: async (msg, sender) => {
      const record = await authorize(msg, sender);
      if (!record) return { ok: false };
      disarm(msg.nonce);
      await markProbed(msg.nonce);
      // It answered, so it goes first next time. There is no request left to learn that from.
      await remember(record.endpoint);
      return { ok: true, url: record.url };
    },

    /** A session was opened. This is the only path that fences a tab and moves it. */
    handoff: async (msg, sender) => {
      const record = await authorize(msg, sender);
      if (!record) return { ok: false };
      // Refused, and the launch stays open. Spending the nonce here would hand every script on the
      // console origin a way to kill a launch it cannot redirect, and the pin already makes the
      // attempt harmless.
      // Coerced once and then used: checking one value and acting on another is how a pin gets
      // walked past, and the only reason it cannot be here is that Chrome clones the message.
      const proxyUrl = String(msg.proxyUrl ?? '');
      if (!verifyBootstrap(proxyUrl, record.url).ok) return { ok: false };
      try {
        await fence({ tabId: record.tabId, targetOrigin: record.targetOrigin, proxyUrl });
      } catch (e) {
        await takePending(msg.nonce);
        disarm(msg.nonce);
        await put(record.tabId, record.url, 'error',
          /** @type {any} */ (e)?.code ?? ErrorCode.NO_SESSION);
        return { ok: false };
      }
      await takePending(msg.nonce);
      disarm(msg.nonce);
      return { ok: true };
    },

    /**
     * The session could not be opened. The console is already saying so on the page, but the popup
     * is where someone goes when the page has run out of answers, and by the time this record is
     * spent the address they asked for exists nowhere else. Keeping it is what turns that panel from
     * a description of our own site into a retry.
     *
     * A launch they stopped themselves is not a failure and leaves nothing behind.
     */
    failed: async (msg, sender) => {
      const record = await authorize(msg, sender);
      if (!record) return { ok: false };
      await takePending(msg.nonce);
      disarm(msg.nonce);
      if (msg.reason === HANDOFF_CANCELLED) await setBadge(record.tabId, 'none');
      else await put(record.tabId, record.url, 'error', ErrorCode.NO_SESSION);
      return { ok: true };
    },
  });
}
