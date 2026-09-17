/**
 * Ein kleiner Zwischenspeicher für Verkehrsmeldungen.
 *
 * ─── WARUM ES IHN GEBEN MUSS ────────────────────────────────────────────────
 * Ohne ihn würde jede Kartenbewegung und jede Neuberechnung einer Route die
 * Autobahn-Schnittstelle erneut anfragen. Das wäre schlechtes Benehmen
 * gegenüber einem Dienst, der ohne Schlüssel und ohne Anmeldung offensteht —
 * und im Wohnmobil obendrein teuer: Yapaia läuft dort an einem
 * Mobilfunkanschluss.
 *
 * ─── DIE ENTSCHEIDUNG, AUF DIE ES ANKOMMT ───────────────────────────────────
 * Ein abgelaufener Eintrag wird NICHT weggeworfen.
 *
 * Wer auf der A61 steht und kein Netz hat, ist mit einer zwanzig Minuten alten
 * Baustellenmeldung erheblich besser bedient als mit einer leeren Karte. Eine
 * Baustelle steht Wochen; zwanzig Minuten ändern daran nichts.
 *
 * Aber: das Alter muss MITGELIEFERT werden. Alte Daten als frische
 * auszugeben wäre genau die Sorte beruhigender Auskunft, die dieses Projekt
 * schon mehrfach teuer bezahlt hat. Deshalb sagt `lies()` immer beides —
 * was da ist UND wie alt es ist.
 */

import type { Verkehrsmeldung } from './autobahn.js';

/** Wie lange ein Eintrag als frisch gilt. */
export const VERKEHR_FRISCH_MS = 5 * 60 * 1000;

/**
 * Wie lange ein abgelaufener Eintrag noch ausgeliefert wird, wenn nichts
 * Neues zu holen ist.
 *
 * Sechs Stunden: eine Tagesetappe im Wohnmobil. Danach ist die Auskunft so
 * alt, dass „ich weiß es nicht" ehrlicher ist als sie.
 */
export const VERKEHR_HOECHSTALTER_MS = 6 * 60 * 60 * 1000;

export interface CacheTreffer {
  meldungen: Verkehrsmeldung[];
  /** Wie alt der Eintrag ist, in Millisekunden. */
  alterMs: number;
  /** `false` heißt: verwendbar, aber der Betreiber muss das Alter erfahren. */
  frisch: boolean;
}

interface Eintrag {
  meldungen: Verkehrsmeldung[];
  zeit: number;
}

export class VerkehrCache {
  private readonly eintraege = new Map<string, Eintrag>();

  constructor(
    private readonly jetzt: () => number = () => Date.now(),
    private readonly frischMs: number = VERKEHR_FRISCH_MS,
    private readonly hoechstalterMs: number = VERKEHR_HOECHSTALTER_MS,
  ) {}

  /**
   * Was für diesen Schlüssel da ist — oder `null`.
   *
   * `null` heißt „gar nichts", nicht „nichts Frisches". Ein zu alter Eintrag
   * wird dabei auch gleich entfernt: er wird nie wieder gebraucht, und ein
   * Speicher, der nur wächst, läuft auf einem Gerät mit 16 GB irgendwann in
   * genau das Problem, das er vermeiden sollte.
   */
  lies(schluessel: string): CacheTreffer | null {
    const eintrag = this.eintraege.get(schluessel);
    if (!eintrag) return null;

    const alterMs = this.jetzt() - eintrag.zeit;
    if (alterMs > this.hoechstalterMs) {
      this.eintraege.delete(schluessel);
      return null;
    }
    return { meldungen: eintrag.meldungen, alterMs, frisch: alterMs <= this.frischMs };
  }

  schreibe(schluessel: string, meldungen: readonly Verkehrsmeldung[]): void {
    this.eintraege.set(schluessel, { meldungen: [...meldungen], zeit: this.jetzt() });
  }

  /** Nur für Tests und die Diagnose: wie viele Schlüssel liegen hier. */
  groesse(): number {
    return this.eintraege.size;
  }
}
