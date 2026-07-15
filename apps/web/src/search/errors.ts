/**
 * Maps search error codes to a user-facing German message (E05-T2), same
 * spirit as `apps/web/src/routing/errors.ts`'s `friendlyRoutingErrorMessage`
 * -- a clean, generic message rather than surfacing the raw backend text.
 */
export function friendlySearchErrorMessage(code: string, message: string): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'Ungültige Sucheingabe.';
    case 'RATE_LIMITED':
      return 'Zu viele Suchanfragen. Bitte kurz warten.';
    default:
      return message || 'Suche fehlgeschlagen. Bitte später erneut versuchen.';
  }
}
