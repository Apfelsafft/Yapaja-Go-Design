/**
 * Der Satz, der über der Karte steht — oder eben keiner.
 *
 * ─── WARUM DAS EINE EIGENE FUNKTION IST ─────────────────────────────────────
 * Weil die Entscheidung „wann sagt Yapaia etwas, und wann schweigt es"
 * geprüft gehört, und weil sie in einer React-Komponente nur noch im Browser
 * zu erreichen wäre.
 *
 * ─── DIE ABWÄGUNG ──────────────────────────────────────────────────────────
 * Ein Hinweis, der bei jeder Fahrt dasteht, wird nach drei Tagen nicht mehr
 * gelesen. Ein Hinweis, der fehlt, wenn die Hälfte der Strecke ungeprüft
 * blieb, ist eine stille Falschauskunft.
 *
 * Deshalb: geschwiegen wird, wenn alles frisch da ist. Gesprochen wird genau
 * dann, wenn etwas FEHLT — eine Autobahn ohne Antwort, ein alter Stand, oder
 * Meldungen ohne Ort, die es nicht auf die Karte geschafft haben.
 */

export interface HinweisEingabe {
  strassen: ReadonlyArray<{
    strasse: string;
    quelle: 'frisch' | 'zwischenspeicher' | 'fehler';
    alter_s?: number;
  }>;
  /** Meldungen mit Text, aber ohne Ort. */
  ohneOrt: number;
  /** Gesetzt, wenn der Abruf selbst scheiterte. */
  fehler: string | null;
}

export interface Hinweis {
  /** `warnung` bedeutet: hier fehlt etwas, das auf der Strecke liegen könnte. */
  stufe: 'warnung' | 'hinweis';
  text: string;
  /**
   * Was diesen Hinweis ausmacht — OHNE das Alter.
   *
   * Die Anzeige blendet einen Hinweis nach kurzer Zeit aus und zeigt ihn
   * erst wieder, wenn sich dieser Schlüssel ändert. Stünde das Alter darin,
   * wäre „17 Minuten" ein anderer Hinweis als „16 Minuten", und er käme
   * jede Minute zurück — genau das, was gemeldet wurde: „Die war die ganze
   * Zeit über sichtbar, für längere Zeit."
   */
  schluessel: string;
}

/**
 * Wie lange ein Hinweis der Stufe `hinweis` stehen bleibt.
 *
 * Lang genug, um ihn beim Blick auf die Karte einmal zu lesen; kurz genug,
 * dass er nicht zur Tapete wird. Eine `warnung` bleibt dagegen stehen, bis
 * man sie antippt — dort fehlt etwas, das auf der Strecke liegen kann.
 */
export const HINWEIS_SICHTBAR_MS = 10_000;

/** Minuten, gerundet, mit passender Einzahl. */
function alterInWorten(sekunden: number): string {
  const minuten = Math.round(sekunden / 60);
  if (minuten <= 1) return 'etwa eine Minute';
  if (minuten < 60) return `etwa ${minuten} Minuten`;
  const stunden = Math.round(minuten / 60);
  return stunden === 1 ? 'etwa eine Stunde' : `etwa ${stunden} Stunden`;
}

/**
 * `null` heißt: alles in Ordnung, nichts zu sagen.
 */
export function verkehrHinweis(eingabe: HinweisEingabe): Hinweis | null {
  const fehlend = eingabe.strassen.filter((s) => s.quelle === 'fehler').map((s) => s.strasse);
  const alt = eingabe.strassen.filter((s) => s.quelle === 'zwischenspeicher');

  // ─── DIE WARNUNG HAT VORRANG ──────────────────────────────────────────
  // Eine Autobahn ohne Daten ist die einzige Lage, in der jemand in etwas
  // hineinfahren kann, das Yapaia hätte wissen können. Sie steht deshalb
  // allein da und nicht hinter zwei anderen Sätzen.
  if (fehlend.length > 0) {
    return {
      stufe: 'warnung',
      text:
        `Für ${fehlend.join(', ')} liegen gerade keine Verkehrsdaten vor — ` +
        'dort kann etwas sein, das hier nicht steht.',
      schluessel: `fehlt:${fehlend.join(',')}`,
    };
  }

  // Der Abruf als Ganzes ging schief, aber einzelne Straßen sind nicht
  // benannt (etwa weil die Dienste gar nicht eingeschaltet sind).
  if (eingabe.fehler !== null && eingabe.strassen.length === 0) {
    return { stufe: 'warnung', text: eingabe.fehler, schluessel: `abruf:${eingabe.fehler}` };
  }

  if (alt.length > 0) {
    const aeltest = Math.max(...alt.map((s) => s.alter_s ?? 0));
    return {
      stufe: 'hinweis',
      text: `Verkehrsdaten für ${alt.map((s) => s.strasse).join(', ')} sind ${alterInWorten(aeltest)} alt.`,
      schluessel: `alt:${alt.map((s) => s.strasse).join(',')}`,
    };
  }

  if (eingabe.ohneOrt > 0) {
    return {
      stufe: 'hinweis',
      text:
        `${eingabe.ohneOrt} Meldung(en) ohne Ortsangabe — sie stehen nicht auf der Karte.`,
      schluessel: 'ohne-ort',
    };
  }

  return null;
}
