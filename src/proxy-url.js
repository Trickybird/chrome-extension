/**
 * The proxy's address format: the target origin is base64url-encoded into the path, and the path,
 * query and fragment that follow stay literal. test/fixtures/url-vectors.json holds the vectors the
 * server side is built against.
 */

const PREFIX = '/_o/';

/** What the format carries. The vectors hold sockets as well as pages, and nothing else is a target. */
const SCHEMES = new Set(['https:', 'http:', 'wss:', 'ws:']);

/** @param {string} encoded */
function decodeOrigin(encoded) {
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

/**
 * Reads a proxied address back, or null.
 *
 * What comes in is hostile: the address bar of a proxied tab belongs to the page, which can push
 * any path it likes under `/_o/`. Everything downstream draws this or hands it to `new URL`, so it
 * is parsed once here, and a segment that decodes to something that is not a web address is not
 * proxied as far as this function is concerned.
 *
 * @param {string} url
 */
export function fromProxyUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!u.pathname.startsWith(PREFIX)) return null;
  const [encoded, ...rest] = u.pathname.slice(PREFIX.length).split('/');

  let target;
  try {
    target = new URL(decodeOrigin(encoded));
  } catch {
    return null;
  }
  if (!SCHEMES.has(target.protocol)) return null;

  return { endpoint: u.origin, origin: target.origin, path: `/${rest.join('/')}` };
}
