/**
 * A named set of records in session storage, which is memory-backed: nothing kept here reaches disk.
 *
 * Writes are serialised because read-modify-write against storage is not. Two tabs losing their
 * connection in the same moment each raise an offer, and the second write would otherwise be built
 * on a set the first had not saved yet, so one of them simply disappears. One worker, one queue,
 * which is all the ordering this needs.
 */

/**
 * @template T
 * @typedef {{
 *   read: () => Promise<Record<string, T>>,
 *   update: <R>(change: (records: Record<string, T>) => [Record<string, T>, R]) => Promise<R>,
 * }} SessionMap
 */

/**
 * @template T
 * @param {string} key
 * @returns {SessionMap<T>}
 */
export function sessionMap(key) {
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  const read = async () => /** @type {Record<string, T>} */ (
    (await chrome.storage.session.get(key))[key] ?? {});

  /** @type {SessionMap<T>['update']} */
  const update = (change) => {
    const done = queue.then(async () => {
      const records = await read();
      const [next, result] = change(records);
      // The same set back means nothing changed, and a write nobody needs is still a write.
      if (next !== records) await chrome.storage.session.set({ [key]: next });
      return result;
    });
    // A failed write must not wedge every write behind it.
    queue = done.catch(() => {});
    return done;
  };

  return { read, update };
}
