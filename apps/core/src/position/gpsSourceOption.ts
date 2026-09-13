/**
 * Die Add-on-Option `gps_source` — und ihr alter Name.
 *
 * ─── DIE UMBENENNUNG ────────────────────────────────────────────────────────
 * Gewünscht: „Bitte benenne ha_tracker auch in Companion App um."
 *
 * Berechtigt: `ha_tracker` beschreibt den WEG (eine
 * Home-Assistant-`device_tracker`-Entität), nicht die Sache. Wer die Option
 * einstellt, denkt „meine Companion App soll die Position liefern" und sucht
 * genau dieses Wort. In der Add-on-Konfiguration steht der rohe Wert — ein
 * schöneres Etikett allein hätte also nichts geändert.
 *
 * ─── WARUM DER ALTE WERT TROTZDEM GILT ──────────────────────────────────────
 * Bestehende Installationen tragen `ha_tracker` in ihrer Konfiguration. Würde
 * der Wert einfach verschwinden, stünde nach dem Update eine Einstellung da,
 * die das Schema nicht mehr kennt — und die Positionsquelle wäre still aus.
 * Ein Update darf nicht die Navigation abschalten. Beide Werte bedeuten
 * deshalb dasselbe, und `init-yapaja-config.sh` schreibt den alten auf den
 * neuen um.
 *
 * ─── WAS BEWUSST NICHT UMBENANNT WIRD ───────────────────────────────────────
 * `Position.source` heißt weiterhin `'ha_tracker'`. Das ist kein Etikett,
 * sondern Übertragungsformat: es steht in `nav/state`, in den MQTT-Nutzlasten
 * und in den Home-Assistant-Entitäten. Wer darauf eine Automatisierung gebaut
 * hat, verlöre sie bei einer Umbenennung — ein hoher Preis für ein Wort, das
 * dort ohnehin niemand liest.
 */

/** Der Wert, der heute in der Add-on-Konfiguration steht. */
export const COMPANION_APP_OPTION = 'companion_app';

/** Der Wert bis 0.8.2. Gilt unverändert weiter. */
export const COMPANION_APP_OPTION_ALT = 'ha_tracker';

/**
 * Ist „Position aus der Companion App" gewählt?
 *
 * Eine Funktion und nicht ein Vergleich an jeder Aufrufstelle: es gibt zwei
 * gültige Werte, und ein vergessener zweiter Vergleich wäre ein Schalter, der
 * bei der Hälfte der Installationen stillschweigend nichts tut.
 */
export function istCompanionAppQuelle(gpsSource: string | undefined | null): boolean {
  return gpsSource === COMPANION_APP_OPTION || gpsSource === COMPANION_APP_OPTION_ALT;
}
