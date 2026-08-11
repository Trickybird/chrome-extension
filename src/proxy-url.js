/**
 * The proxy's address format: the target origin is base64url-encoded into the path, and the path,
 * query and fragment that follow stay literal. test/fixtures/url-vectors.json holds the vectors
 * the server side is built against.
 */

const PREFIX = '/_o/';

/** base64url, no padding. @param {string} origin */
export function encodeOrigin(origin) {
  return btoa(origin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** @param {string} encoded */
export function decodeOrigin(encoded) {
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

/** What a redirect rule substitutes into. @param {string} endpoint @param {string} origin */
export function proxyPrefix(endpoint, origin) {
  return `${endpoint.replace(/\/+$/, '')}${PREFIX}${encodeOrigin(origin)}/`;
}

/** Reads a proxied URL back, or null. @param {string} url */
export function fromProxyUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!u.pathname.startsWith(PREFIX)) return null;
  const [encoded, ...rest] = u.pathname.slice(PREFIX.length).split('/');
  try {
    return { endpoint: u.origin, origin: decodeOrigin(encoded), path: `/${rest.join('/')}` };
  } catch {
    return null;
  }
}
