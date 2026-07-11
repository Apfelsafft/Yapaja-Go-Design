/**
 * `RoutingError` -- the single, typed error the routing pipeline throws. It
 * carries the exact HTTP status and the stable error `code`/`message` that the
 * plugin serialises as `{ error: { code, message } }` (docs/03-api-spec.md
 * unified error format). Throwing this (rather than leaking raw Valhalla
 * errors or generic Errors) is what guarantees "keine stillen Fehler": every
 * failure path has a deliberate status + code + message.
 */
export class RoutingError extends Error {
  readonly httpStatus: number;
  readonly code: string;

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
