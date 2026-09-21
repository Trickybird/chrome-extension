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

const REVOKE_PREFIX = 'tbrev1';
// A revocation carries its own context, so a catalog signature cannot be presented as one, nor the
// reverse. It rides on the same name as the catalog, and `parseCatalog` refuses it on the field
// count, so a build that predates revocation simply never sees it.
const REVOKE_CONTEXT = 'tb-fronts-revoke-v1|';

/** Hostname, no scheme, no path, no port: the record names who to ask, never what to ask for. */
const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const MAX_HOSTS = 24;

/** What a signature check needs, and all it needs: the bytes and the signature over them. */
/** @typedef {{ signature: Uint8Array, signed: Uint8Array }} Signed */
/** @typedef {Signed & { version: number, hosts: string[] }} Catalog */
/** @typedef {Signed} Revocation */

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
 * @param {Signed} catalog @param {string} rawPublicKey base64url of the uncompressed P-256 point
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

/**
 * `tbrev1 <base64url signature>`, one line, and it names no key. The signed bytes are built from
 * the key this build already pins, so a revocation is inert against any other build and there is
 * nothing in the record for a resolver to swap.
 *
 * There is no version and no floor here on purpose. The version space is exhaustible: whoever holds
 * the private half can publish at `Number.MAX_SAFE_INTEGER`, which no floor beats. Only taking the
 * key out of trust answers that, and a revocation either applies or it does not.
 *
 * @param {string} text @param {string} rawPublicKey
 * @returns {Revocation | null}
 */
export function parseRevocation(text, rawPublicKey) {
  const parts = String(text).trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== REVOKE_PREFIX) return null;

  let signature;
  try {
    signature = fromBase64Url(parts[1]);
  } catch {
    return null;
  }
  if (signature.length !== 64) return null;

  return {
    signature,
    signed: new TextEncoder().encode(`${REVOKE_CONTEXT}${rawPublicKey}`),
  };
}

/**
 * One verifier serves both, because the shapes are identical and only the signed bytes differ,
 * which the parse already built.
 *
 * Self-signed on purpose. Whoever holds the private half can already publish a hostile list at a
 * version nothing beats, so the power to revoke is strictly weaker than the power they have: it
 * returns every client to the address in its own build. A second key able to sign any version would
 * be STRONGER than the first, because it would bypass the forward-only rule, and would double the
 * number of secrets whose compromise redirects the fleet.
 */
export const verifyRevocation = verifyCatalog;
