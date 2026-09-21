/**
 * Asking DNS over HTTPS, which is how the address list reaches a machine whose network has already
 * blocked us.
 *
 * The point is the asymmetry: the name asked about is ours, but the connection is to a resolver
 * everybody uses. Blackholing our domain does not stop Cloudflare from resolving it, so a censor has
 * to block the resolver itself, and that breaks DoH for everyone on his network.
 *
 * Tried in order, because one of them will eventually be the one that is blocked. Every entry was
 * measured answering this record from a Russian residential line on 2026-09-20; Quad9 and OpenDNS
 * were tried there and did not answer, so they are not here. A resolver that cannot be reached from
 * the networks this list exists for is a delay, not a spare.
 */

const RESOLVERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
  'https://dns.adguard-dns.com/resolve',
  'https://dns.nextdns.io/dns-query',
  'https://dns.sb/dns-query',
];

// Long enough for a slow mobile network, short enough that a tarpit cannot hold the launch.
const TIMEOUT_MS = 2500;

/**
 * A TXT record can arrive as several quoted fragments, and the reader has to join them without
 * inventing a boundary: DNS itself splits at 255 bytes with no meaning attached to where.
 * @param {string} data
 */
const joinStrings = (data) => {
  const quoted = data.match(/"([^"]*)"/g);
  return quoted ? quoted.map((s) => s.slice(1, -1)).join('') : data;
};

/**
 * @param {string} name @param {string} resolver
 * @returns {Promise<string[]>} every TXT record at that name, fragments joined
 */
async function askOne(name, resolver) {
  const url = `${resolver}?name=${encodeURIComponent(name)}&type=TXT`;
  const stop = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: stop });
  if (!res.ok) throw new Error(`resolver answered ${res.status}`);
  const body = /** @type {{ Status?: number, Answer?: { type?: number, data?: string }[] }} */ (
    await res.json());
  // Status 0 is NOERROR. Anything else, including NXDOMAIN, means there is nothing to read.
  if (body.Status !== 0) throw new Error(`resolver status ${body.Status}`);
  return (body.Answer ?? [])
    .filter((a) => a.type === 16 && typeof a.data === 'string')
    .map((a) => joinStrings(/** @type {string} */ (a.data)));
}

/**
 * Asks each resolver in turn and returns the first answer that has records in it. Serially: a
 * parallel round would hand an observer the whole attempt in one burst, and the second resolver is
 * only interesting when the first failed.
 *
 * @param {string} name
 * @returns {Promise<string[]>} empty when nobody answered
 */
export async function lookupTxt(name) {
  for (const resolver of RESOLVERS) {
    try {
      const records = await askOne(name, resolver);
      if (records.length) return records;
    } catch {
      // A blocked resolver, a lying one and a name that does not exist are indistinguishable from
      // here, and all three mean the same thing: ask the next one.
    }
  }
  return [];
}
