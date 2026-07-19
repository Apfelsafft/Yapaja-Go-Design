/**
 * Typed errors for the add-on install/lifecycle pipeline (E09-T1). Mirrors
 * `favorites/service.ts`'s `FavoriteError` shape: an HTTP-mappable `code` +
 * message, thrown by the service layer and translated to a status code by
 * `routes.ts`.
 */
export class AddonError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AddonError';
  }
}

/** Thrown by the tarball extractor for every security rejection (path
 *  traversal, absolute path, symlink/hardlink, disallowed entry type,
 *  uncompressed-size cap exceeded) -- always mapped to `code`
 *  `TARBALL_REJECTED` at the HTTP layer, but keeps the specific reason in
 *  `reason` for logs/tests. */
export class TarballSecurityError extends AddonError {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super('TARBALL_REJECTED', message);
    this.name = 'TarballSecurityError';
  }
}
