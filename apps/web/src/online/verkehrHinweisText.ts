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
}

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
    };
  }

  // Der Abruf als Ganzes ging schief, aber einzelne Straßen sind nicht
  // benannt (etwa weil die Dienste gar nicht eingeschaltet sind).
  if (eingabe.fehler !== null && eingabe.strassen.length === 0) {
    return { stufe: 'warnung', text: eingabe.fehler };
  }

  if (alt.length > 0) {
    const aeltest = Math.max(...alt.map((s) => s.alter_s ?? 0));
    return {
      stufe: 'hinweis',
      text: `Verkehrsdaten für ${alt.map((s) => s.strasse).join(', ')} sind ${alterInWorten(aeltest)} alt.`,
    };
  }

  if (eingabe.ohneOrt > 0) {
    return {
      stufe: 'hinweis',
      text:
        `${eingabe.ohneOrt} Meldung(en) ohne Ortsangabe — sie stehen nicht auf der Karte.`,
    };
  }

  return null;
}
