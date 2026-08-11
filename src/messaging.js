/** The surface-to-background contract, in one place. */

export const Message = {
  tabState: 'tabState',
  route: 'route',
  unroute: 'unroute',
  routedTabs: 'routedTabs',
  takeOffer: 'takeOffer',
  dismissOffer: 'dismissOffer',
};

/** @template T @param {string} type @param {object} [payload] @returns {Promise<T>} */
export const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });

/**
 * @param {Record<string, (msg: any) => Promise<unknown>>} handlers
 * @param {(e: unknown) => object} onError
 */
export function serve(handlers, onError) {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    const handler = handlers[msg?.type];
    if (!handler) return false;
    handler(msg).then(reply, (e) => reply(onError(e)));
    return true; // async reply; keeps the channel open
  });
}
