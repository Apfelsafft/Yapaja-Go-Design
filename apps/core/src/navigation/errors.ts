/**
 * `NavigationError` — the single typed error the navigation control plane
 * throws. Carries the exact HTTP status + stable `code`/`message` the plugin
 * serialises as `{ error: { code, message } }` (docs/03 unified error format).
 * Invalid state-machine transitions throw this with status 409 ("no silent
 * failures": every rejection is a deliberate status + code + message).
 */
export class NavigationError extends Error {
  readonly httpStatus: number;
  readonly code: string;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.name = 'NavigationError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export function isNavigationError(err: unknown): err is NavigationError {
  return err instanceof NavigationError;
}
