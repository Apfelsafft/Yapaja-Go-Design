/**
 * `RoutingError` -- the single, typed error the routing pipeline throws. It
 * carries the exact HTTP status and the stable error `code`/`message` that the
 * plugin serialises as `{ error: { code, message, ...extras } }` (docs/03-api-spec.md
 * unified error format). Throwing this (rather than leaking raw Valhalla
 * errors or generic Errors) is what guarantees "keine stillen Fehler": every
 * failure path has a deliberate status + code + message.
 *
 * Additional optional fields (e.g. `missing_region_hint`, `details`) are
 * serialised into the error response body.
 */
export class RoutingError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  /** Optional: hint about which region would cover an out-of-coverage point. */
  missing_region_hint?: string;
  /** Optional: structured error details for client interpretation. */
  details?: Record<string, unknown>;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.name = 'RoutingError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export function isRoutingError(err: unknown): err is RoutingError {
  return err instanceof RoutingError;
}
