/**
 * Opens a session for one target, walking the configured addresses until one answers. The response
 * names the proxy that will serve it, so the rules point at the answer rather than at a guess.
 */

import { ErrorCode, RoutingError } from './errors.js';

const TIMEOUT_MS = 10000;

/** Pure. Null when the body is unusable. @param {any} body */
export function parseSession(body) {
  const raw = body && typeof body === 'object' ? body.proxyUrl : null;
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:'
      ? { bootstrapUrl: raw, endpoint: u.origin }
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {string[]} endpoints
 * @param {string} targetUrl
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ bootstrapUrl: string, endpoint: string, via: string }>}
 */
export async function openSession(endpoints, targetUrl, fetchImpl = fetch) {
  if (!endpoints.length) throw new RoutingError(ErrorCode.NO_SESSION, 'no session address configured');

  // An address that answers and refuses is a different problem from one that never answers, and
  // the popup says something different about each.
  let answered = false;
  let last = '';

  for (const endpoint of endpoints) {
    let res;
    try {
      res = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/api/proxy-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      last = `${endpoint} ${e}`;
      continue;
    }
    answered = true;
    if (!res.ok) {
      last = `${endpoint} status ${res.status}`;
      continue;
    }
    const parsed = parseSession(await res.json().catch(() => null));
    if (!parsed) {
      last = `${endpoint} unusable response`;
      continue;
    }
    return { ...parsed, via: endpoint };
  }

  throw new RoutingError(
    answered ? ErrorCode.NO_SESSION : ErrorCode.ENDPOINT_UNREACHABLE,
    `${endpoints.length} tried, last: ${last}`,
  );
}
