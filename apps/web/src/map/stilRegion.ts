/**
 * Welche Region in die Stil-Anfrage geht — und welche ausdrücklich NICHT.
 *
 * ─── WOFÜR ES DIESE FUNKTION GIBT ───────────────────────────────────────────
 * Sie ist eine Zeile lang. Sie steht trotzdem hier und nicht mitten in
 * `MapView`, weil genau diese Zeile 0.9.1 vollständig wirkungslos gemacht
 * hat — und niemand hat es gemerkt, weil eine Zeile in einem
 * React-Baustein von keinem Test berührt wird.
 *
 * Gemeldet wurde: „Ich habe Deutschland, Liechtenstein und Schweiz Kacheln
 * gebaut. Sehe aber nur Deutschland."
 *
 * ─── DIE ZWEI REGIONEN, DIE NICHT DASSELBE SIND ─────────────────────────────
 * `manuell`  die feste Wahl im Kartenmenü. `null` heißt „keine getroffen".
 * `aktiv`    die Region, in der das Fahrzeug GERADE steht. Sie ist immer
 *            gesetzt, sobald überhaupt eine Karte installiert ist.
 *
 * Für die Frage „wo bin ich?" ist `aktiv` richtig. Für die Frage „was wird
 * gezeichnet?" ist sie falsch: der Kern zeichnet seit 0.9.1 ALLE
 * installierten Regionen, wenn die Anfrage keine nennt. Wer `aktiv`
 * einsetzt, bekommt garantiert genau eine — und zwar lautlos, denn eine
 * gültige Region ergibt eine gültige Karte. Sie ist nur kleiner, als sie sein
 * müsste.
 *
 * Deshalb nimmt diese Funktion `aktiv` ENTGEGEN, obwohl sie es nicht
 * benutzt: so steht die Entscheidung, es wegzulassen, als Absicht da und
 * nicht als Vergesslichkeit — und ein Test kann sie festhalten.
 */

export interface StilRegionEingabe {
  /** Die feste Wahl aus dem Kartenmenü, `null` für „alle". */
  manuell: string | null;
  /**
   * Die Region der aktuellen Position. Wird BEWUSST nicht verwendet — siehe
   * oben. Sie steht hier, damit der Verzicht sichtbar ist.
   */
  aktiv?: string | null;
}

/**
 * `undefined` heißt „keine Region nennen" und damit: alle zeichnen.
 *
 * Eine leere Zeichenkette zählt wie „keine Wahl". Sonst entstünde ein
 * `?region=`, zu dem der Kern keine Region findet — eine leere Karte ohne
 * Fehlermeldung.
 */
export function stilRegion({ manuell }: StilRegionEingabe): string | undefined {
  if (manuell === null || manuell.trim().length === 0) {
    return undefined;
  }
  return manuell;
}
