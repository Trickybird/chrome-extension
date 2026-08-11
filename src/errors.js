/**
 * Failure causes. Codes are read out in support, so they are stable: a new cause takes the next
 * value, and a retired one is never handed to something else. TB-102 is retired; it meant access to
 * a site was refused, back when the extension had to ask for it.
 */

export const ErrorCode = {
  NO_SESSION: 'TB-101',
  ENDPOINT_UNREACHABLE: 'TB-103',
  NOT_ROUTABLE: 'TB-104',
  TAB_GONE: 'TB-105',
  LAUNCH_EXPIRED: 'TB-106',
};

/** Beside the codes, so a new cause cannot skip its copy. */
export const MESSAGE_KEY = {
  [ErrorCode.NO_SESSION]: { body: 'errNoSessionBody', helper: 'errNoSessionHelper' },
  [ErrorCode.ENDPOINT_UNREACHABLE]: { body: 'errUnreachableBody', helper: 'errUnreachableHelper' },
  [ErrorCode.NOT_ROUTABLE]: { body: 'errNotRoutableBody', helper: 'errNotRoutableHelper' },
  [ErrorCode.TAB_GONE]: { body: 'errTabGoneBody', helper: 'errTabGoneHelper' },
  [ErrorCode.LAUNCH_EXPIRED]: { body: 'errExpiredBody', helper: 'errExpiredHelper' },
};

export class RoutingError extends Error {
  /** @param {string} code @param {string} [detail] */
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RoutingError';
    this.code = code;
  }
}

/**
 * An Error does not survive the message boundary.
 * @param {any} e
 */
export const toFailure = (e) => ({
  ok: /** @type {false} */ (false),
  code: e instanceof RoutingError ? e.code : ErrorCode.NO_SESSION,
  detail: String(e?.message ?? e),
});
