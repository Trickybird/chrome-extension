/**
 * What the console is allowed to hand back. Pure.
 *
 * The console has to hold the address to open it, so every script running on that origin can reach
 * the message that carries the answer. These checks are what stops one of them naming a destination
 * of its own: the reply has to be a bootstrap on a public https host, and its `d` has to decode to
 * the very address this launch was started for.
 */

import { isPrivateHost } from './target.js';

/** Why a reply was refused. Nothing surfaces these yet; the tests name them, so they stay stable. */
export const Refused = {
  scheme: 'scheme',
  private: 'private',
  path: 'path',
  sid: 'sid',
  target: 'target',
};

const SESSION_PATH = '/_session';

/** base64url of the UTF-8 bytes, unpadded. Throws on anything else. @param {string} value */
function decodeTarget(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * @param {string} proxyUrl @param {string} expectedUrl
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyBootstrap(proxyUrl, expectedUrl) {
  let url;
  try {
    url = new URL(String(proxyUrl));
  } catch {
    return { ok: false, reason: Refused.scheme };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: Refused.scheme };
  if (isPrivateHost(url.hostname)) return { ok: false, reason: Refused.private };
  if (url.pathname !== SESSION_PATH) return { ok: false, reason: Refused.path };
  if (!url.searchParams.get('sId')) return { ok: false, reason: Refused.sid };

  let target;
  try {
    target = decodeTarget(url.searchParams.get('d') ?? '');
  } catch {
    return { ok: false, reason: Refused.target };
  }
  if (target !== expectedUrl) return { ok: false, reason: Refused.target };

  return { ok: /** @type {const} */ (true) };
}
