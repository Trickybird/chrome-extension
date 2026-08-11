/** The surface-to-background contract, in one place. */

export const Message = {
  tabState: 'tabState',
  launch: 'launch',
  cancelLaunch: 'cancelLaunch',
  unroute: 'unroute',
  routedTabs: 'routedTabs',
  takeOffer: 'takeOffer',
  dismissOffer: 'dismissOffer',
};

/** Bumped when the console conversation changes shape. Anything else is refused. */
export const HANDOFF_VERSION = 1;

/**
 * The console's word for a launch the person stopped themselves. Every other reason it reports is a
 * failure, and the difference decides whether anything is left behind for them to find.
 */
export const HANDOFF_CANCELLED = 'cancelled';

/**
 * Looks a handler up by a name the sender chose. Own properties only: `constructor` and `toString`
 * are on every object literal, and reaching one of those dispatches into the prototype chain.
 *
 * @template {Record<string, Function>} H
 * @param {H} handlers @param {unknown} name @returns {H[keyof H] | undefined}
 */
const own = (handlers, name) =>
  (typeof name === 'string' && Object.hasOwn(handlers, name)
    ? /** @type {H[keyof H]} */ (handlers[name])
    : undefined);

/** @template T @param {string} type @param {object} [payload] @returns {Promise<T>} */
export const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });

/**
 * @param {Record<string, (msg: any) => Promise<unknown>>} handlers
 * @param {(e: unknown) => object} onError
 */
export function serve(handlers, onError) {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    const handler = own(handlers, msg?.type);
    if (!handler) return false;
    handler(msg).then(reply, (e) => reply(onError(e)));
    return true; // async reply; keeps the channel open
  });
}

/**
 * The console's channel. Separate from `serve` because the sender is a web page rather than our own
 * surfaces: every reply is the same shapeless refusal, and the handler decides whether to say more.
 *
 * @param {number} version
 * @param {Record<string, (msg: any, sender: chrome.runtime.MessageSender) => Promise<unknown>>} handlers
 */
export function serveExternal(version, handlers) {
  chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
    const handler = msg?.v === version ? own(handlers, msg?.op) : undefined;
    if (!handler) {
      reply({ ok: false });
      return false;
    }
    handler(msg, sender).then(reply, () => reply({ ok: false }));
    return true;
  });
}
