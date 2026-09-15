/**
 * Die Add-on-Option `gps_source` — der Wert für „Position aus der Companion App".
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
 * ─── DER ALTE WERT IST SEIT 0.8.8 WEG ───────────────────────────────────────
 * Bis 0.8.7 galt `ha_tracker` als zweiter, gleichbedeutender Wert weiter,
 * damit ein Update keine bestehende Installation still ohne Positionsquelle
 * dastehen lässt. Bezahlt wurde das mit zwei Knöpfen in der
 * Konfigurationsseite, die dasselbe bedeuten — sichtbar und ohne jeden
 * Hinweis darauf, dass der eine nur der alte Name des anderen ist.
 *
 * Der Betreiber hat die Lage geklärt: „Bis jetzt teste nur ich Yapaia […] Es
 * ist also kein Problem bestehende Konfigurationen zu brechen." Damit ist die
 * Rücksicht auf Installationen gegenstandslos, die es nicht gibt, und der
 * doppelte Knopf hat keine Rechtfertigung mehr.
 *
 * ─── WAS WEITERHIN NICHT UMBENANNT WIRD ─────────────────────────────────────
 * `Position.source` heißt weiterhin `'ha_tracker'`. Das ist kein Etikett,
 * sondern Übertragungsformat: es steht in `nav/state`, in den MQTT-Nutzlasten
 * und in den Home-Assistant-Entitäten. Es ist auch KEINE Konfiguration —
 * die Freigabe oben betrifft es deshalb nicht. Wer darauf eine
 * Automatisierung gebaut hat, verlöre sie bei einer Umbenennung, und
 * gewonnen wäre nichts: in der Oberfläche steht dort ohnehin „Companion App"
 * (`onboarding/steps/GpsStep.tsx`).
 */

/** Der Wert in der Add-on-Konfiguration. Der einzige seit 0.8.8. */
export const COMPANION_APP_OPTION = 'companion_app';

/**
 * Ist „Position aus der Companion App" gewählt?
 *
 * Eine Funktion und nicht ein Vergleich an jeder Aufrufstelle: so steht der
 * Optionswert an EINER Stelle. Bis 0.8.7 war das zwingend, weil es zwei
 * gültige Werte gab und ein vergessener zweiter Vergleich ein Schalter
 * gewesen wäre, der bei der Hälfte der Installationen nichts tut.
 */
export function istCompanionAppQuelle(gpsSource: string | undefined | null): boolean {
  return gpsSource === COMPANION_APP_OPTION;
}
