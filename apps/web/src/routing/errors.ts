/**
 * Maps routing error codes to user-facing German messages (E03-T3, E03-T6).
 * `NO_POSITION` (409, thrown by the Core when `origin: 'current'` can't be
 * resolved because there's no live GPS fix) gets a dedicated, actionable
 * hint; `OUT_OF_COVERAGE` (422, E03-T6) gets a hint about downloading regions.
 * Everything else falls back to the Core's own message.
 */
export function friendlyRoutingErrorMessage(code: string, message: string): string {
  switch (code) {
    case 'NO_POSITION':
      return 'Aktuelle Position nicht verfügbar. Bitte GPS aktivieren und erneut versuchen.';
    case 'NO_ACTIVE_PROFILE':
      return 'Kein aktives Fahrzeugprofil ausgewählt. Bitte zuerst ein Profil aktivieren.';
    case 'OUT_OF_COVERAGE':
      return 'Ziel liegt außerhalb der installierten Kartenabdeckung. Bitte weitere Regionen herunterladen.';
    default:
      return message;
  }
}
