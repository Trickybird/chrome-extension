/**
 * The signed list of addresses we answer on. Pure apart from the signature check.
 *
 * The list cannot ship in here: this folder is public, so a censor would read it once and block
 * every address in one go. It arrives instead as a signed record the extension looks up, which
 * means rotating an address costs a signature rather than a store release.
 *
 * Everything about the record assumes the network is hostile. It is signed, so a resolver that lies
 * is caught; the version only moves forward, so yesterday's list cannot be replayed over today's;
 * and the schema carries hostnames and nothing else, because a field able to hold a URL is a field
 * able to send someone somewhere.
 */

const RECORD_PREFIX = 'tb1';
// Signed bytes are prefixed with this, so a signature can never be lifted from somewhere else and
// presented here, nor one of ours presented there.
const SIGNING_CONTEXT = 'tb-fronts-v1|';

/** Hostname, no scheme, no path, no port: the record names who to ask, never what to ask for. */
const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const MAX_HOSTS = 24;

/** @typedef {{ version: number, hosts: string[], signature: Uint8Array, signed: Uint8Array }} Catalog */

/** @param {string} value */
function fromBase64Url(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
}

/**
 * `tb1 <version> <host,host,...> <base64url signature>`, one line. Whitespace-separated because a
 * TXT record arrives as fragments that have to be joined, and joining must not be able to invent a
 * field boundary that was not there.
 *
 * @param {string} text
 * @returns {Catalog | null}
 */
export function parseCatalog(text) {
  const parts = String(text).trim().split(/\s+/);
  if (parts.length !== 4 || parts[0] !== RECORD_PREFIX) return null;

  const [, rawVersion, rawHosts, rawSignature] = parts;
  const version = Number(rawVersion);
  if (!Number.isSafeInteger(version) || version < 1) return null;

  const hosts = rawHosts.split(',').filter(Boolean);
  if (hosts.length === 0 || hosts.length > MAX_HOSTS) return null;
  if (!hosts.every((h) => h.length <= 253 && HOST.test(h))) return null;
  if (new Set(hosts).size !== hosts.length) return null;

  let signature;
  try {
    signature = fromBase64Url(rawSignature);
  } catch {
    return null;
  }
  // P-256, so r and s of 32 bytes each. A length check here keeps a malformed record out of
  // WebCrypto rather than relying on it to reject.
  if (signature.length !== 64) return null;

  return {
    version,
    hosts,
    signature,
    signed: new TextEncoder().encode(`${SIGNING_CONTEXT}${version}|${hosts.join(',')}`),
  };
}

/**
 * @param {Catalog} catalog @param {string} rawPublicKey base64url of the uncompressed P-256 point
 * @returns {Promise<boolean>}
 */
export async function verifyCatalog(catalog, rawPublicKey) {
  try {
    const key = await crypto.subtle.importKey(
      'raw', /** @type {BufferSource} */ (fromBase64Url(rawPublicKey)),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key,
      /** @type {BufferSource} */ (catalog.signature),
      /** @type {BufferSource} */ (catalog.signed),
    );
  } catch {
    return false;
  }
}

/**
 * Whether a verified catalog may replace what we hold. Forward only, so a censor cannot serve a real
 * record from last year to walk someone back onto addresses he has already blocked. `floor` is the
 * version shipped in this build and covers the one case a stored version cannot: a fresh install,
 * which has nothing to compare against.
 *
 * @param {Catalog} catalog @param {number} storedVersion @param {number} floor
 */
export const acceptsCatalog = (catalog, storedVersion, floor) =>
  catalog.version > storedVersion && catalog.version >= floor;
