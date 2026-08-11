/** What may be routed. Pure. */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Parses the octets: a prefix match would catch names like 10.example.com. */
/** @param {string} host */
function isPrivateV4(host) {
  const m = IPV4.exec(host);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((o) => o > 255)) return false;
  const [a, b] = parts;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31);
}

/** Only for an actual IPv6 literal; fc/fd are also ordinary name prefixes. */
/** @param {string} host */
function isPrivateV6(host) {
  if (!host.includes(':')) return false;
  return host === '::1' || /^fe[89ab]/.test(host) || /^f[cd]/.test(host);
}

/** Hosts that never reach a proxy. @param {string} host */
export function isPrivateHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (isPrivateV4(h) || isPrivateV6(h)) return true;
  // Single-label names resolve inside the local network.
  return !h.includes('.') && !h.includes(':');
}

/** Why a page cannot be routed. */
export const NotRoutable = {
  scheme: 'scheme',
  private: 'private',
};

/**
 * @param {string|undefined} url
 * @returns {{ ok: true, origin: string, host: string } | { ok: false, reason: string }}
 */
export function classify(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return { ok: false, reason: NotRoutable.scheme };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: NotRoutable.scheme };
  }
  if (isPrivateHost(u.hostname)) return { ok: false, reason: NotRoutable.private };
  return { ok: true, origin: u.origin, host: u.host };
}
