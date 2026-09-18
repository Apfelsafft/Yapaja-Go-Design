/**
 * Wie lange der Gesamtbau noch dauert — und wann man das NICHT sagen kann.
 *
 * ─── DIE FRAGE, DIE DAHINTERSTEHT ───────────────────────────────────────────
 * Gewünscht: „Wenn möglich mit einer geschätzten Zeit wann die Aktion fertig
 * ist. Sollte sich entsprechend des Bau-Fortschritts aktualisieren."
 *
 * „Wenn möglich" ist hier das entscheidende Wort, denn meistens ist es das
 * nicht — und die bequeme Antwort wäre, trotzdem eine Zahl hinzuschreiben.
 *
 * ─── WARUM ES KEINEN FORTSCHRITT IN PROZENT GIBT ────────────────────────────
 * In `build.ts` steht seit B-04 die Begründung, und sie gilt unverändert:
 * planetilers Ausgabe lässt sich nicht versionsstabil in eine Zahl
 * übersetzen, und die Phasen (PBF laden, Knoten lesen, Kacheln schreiben)
 * sind unterschiedlich lang. Dasselbe gilt für `valhalla_build_tiles` und
 * `osmium`.
 *
 * Eine Prozentzahl daraus wäre erfunden. Aus einer erfundenen Prozentzahl
 * eine Restzeit zu rechnen, wäre eine erfundene Zahl mit einer Einheit dahinter
 * — also schlimmer, weil sie überprüfbar aussieht.
 *
 * ─── WAS STATTDESSEN MESSBAR IST ────────────────────────────────────────────
 * Wie lange derselbe Schritt für dieselbe Region beim LETZTEN MAL gedauert
 * hat. Das ist keine Schätzung aus dem Inneren des Laufs, sondern eine
 * Messung von aussen — dieselbe Region, dasselbe Werkzeug, dasselbe Gerät.
 * Für die eine Frage, um die es geht („wann kann ich wieder losfahren?"),
 * ist das die bei weitem verlässlichste Auskunft, die überhaupt zu haben ist.
 *
 * Beim ERSTEN Lauf gibt es sie nicht. Dann steht hier `null` und die
 * Oberfläche sagt, dass es noch keine Erfahrungswerte gibt — statt einer
 * Zahl, die aus nichts entstanden ist.
 *
 * ─── DREI SORTEN AUSKUNFT, DIE NICHT DASSELBE SIND ──────────────────────────
 * Für jemanden, der neben dem Wohnmobil steht und wissen will, ob sich das
 * Warten lohnt, sind diese drei sehr verschiedene Auskünfte:
 *
 *   `geschaetzt`   jeder verbleibende Schritt wurde schon einmal gemessen —
 *                  das ist eine echte Schätzung.
 *   `mindestens`   mindestens ein Schritt ist neu. Die Summe der bekannten
 *                  ist dann eine UNTERGRENZE, keine Schätzung. Sie als
 *                  Schätzung auszugeben, wäre die gefährlichere Lüge: sie
 *                  fällt immer zu kurz aus.
 *   `unbekannt`    gar nichts gemessen. Dann wird nichts behauptet.
 *
 * Dazu kommt der Fall, den jede Fortschrittsanzeige irgendwann hat:
 *
 *   `ueberfaellig` der laufende Schritt dauert länger als beim letzten Mal.
 *                  Eine Restzeit, die bei „0 Min." stehenbleibt und sich
 *                  nicht mehr rührt, sieht aus wie ein Hänger. Diese Lage
 *                  wird deshalb benannt statt kaschiert.
 */

/** Was in einem Gesamtbau nacheinander gebaut wird. */
export type Bauart = 'routing' | 'suche';

/** Ein Schritt des Gesamtbaus. */
export interface Bauschritt {
  bauart: Bauart;
  /**
   * Die Region, um die es geht.
   *
   * Beim Routinggraphen ist das die Region, unter der der Lauf angestossen
   * wurde — gebaut wird seit 0.10.2 ohnehin über ALLE installierten Karten.
   * Für die Messung zählt trotzdem die Zusammenstellung, nicht der Name;
   * siehe `routingSchluessel`.
   */
  region: string;
}

/**
 * Gemessene Dauern in SEKUNDEN, je Schlüssel.
 *
 * Bewusst ein schlichtes Objekt: es wird als JSON abgelegt, und ein Format,
 * das man mit blossem Auge lesen kann, ist bei einer Datei, die jemand im
 * Zweifel von Hand löschen soll, mehr wert als ein kompaktes.
 */
export type Bauerfahrung = Record<string, number>;

/**
 * Der Schlüssel des Routingschritts.
 *
 * ─── WARUM NICHT EINFACH DIE REGION ─────────────────────────────────────────
 * Ein Routingbau deckt ALLE installierten Karten ab. Seine Dauer hängt damit
 * nicht an der Region, unter der jemand den Knopf gedrückt hat, sondern an
 * der Menge der Karten insgesamt. Wer gestern nur Liechtenstein hatte und
 * heute Deutschland dazu, bekäme mit einem regionsbezogenen Schlüssel die
 * Dauer von gestern angeboten — und die wäre um zwei Grössenordnungen daneben.
 *
 * Deshalb steht im Schlüssel die sortierte Liste aller beteiligten Regionen.
 * Ändert sich die Zusammenstellung, gibt es eben keinen Erfahrungswert, und
 * das ist richtig so: es IST ein anderer Bau.
 */
export function routingSchluessel(regionen: readonly string[]): string {
  return `routing:${[...regionen].sort().join(',')}`;
}

/** Der Schlüssel eines Schritts. */
export function schluessel(schritt: Bauschritt, alleRegionen: readonly string[]): string {
  if (schritt.bauart === 'routing') return routingSchluessel(alleRegionen);
  return `suche:${schritt.region}`;
}

/** Woran man bei der Restzeit ist. Siehe Kopfkommentar. */
export type Restgrund = 'geschaetzt' | 'mindestens' | 'ueberfaellig' | 'unbekannt';

export interface Restauskunft {
  /** Verbleibende Sekunden, oder `null`, wenn nichts zu sagen ist. */
  sekunden: number | null;
  grund: Restgrund;
}

export interface RestdauerEingabe {
  /** Alle Schritte des Laufs, in der Reihenfolge, in der sie laufen. */
  plan: readonly Bauschritt[];
  /** Wie viele Schritte fertig sind. `plan[erledigt]` läuft gerade. */
  erledigt: number;
  /** Wie lange der laufende Schritt schon läuft, in Millisekunden. */
  laufendSeitMs: number;
  /** Was frühere Läufe gemessen haben. */
  erfahrung: Bauerfahrung;
  /** Alle installierten Regionen — für den Routing-Schlüssel. */
  alleRegionen: readonly string[];
}

/**
 * Die verbleibende Zeit des GANZEN Laufs.
 *
 * Rein: keine Uhr, kein Dateisystem. Die Zeit kommt als `laufendSeitMs`
 * herein, damit jede Regel einzeln prüfbar ist.
 */
export function restdauer({
  plan,
  erledigt,
  laufendSeitMs,
  erfahrung,
  alleRegionen,
}: RestdauerEingabe): Restauskunft {
  const offen = plan.slice(Math.max(0, erledigt));
  if (offen.length === 0) {
    // Nichts mehr offen heisst fertig — und zwar sicher, nicht geschätzt.
    return { sekunden: 0, grund: 'geschaetzt' };
  }

  const dauerVon = (schritt: Bauschritt): number | null => {
    const wert = erfahrung[schluessel(schritt, alleRegionen)];
    return typeof wert === 'number' && Number.isFinite(wert) && wert > 0 ? wert : null;
  };

  const laufend = offen[0];
  const laufendDauer = dauerVon(laufend);
  const laufendSeitS = Math.max(0, laufendSeitMs / 1000);

  let summe = 0;
  let luecke = false;

  // Der laufende Schritt: was von seiner gemessenen Dauer noch übrig ist.
  let ueberfaellig = false;
  if (laufendDauer === null) {
    luecke = true;
  } else if (laufendSeitS >= laufendDauer) {
    // Er läuft länger als beim letzten Mal. Ab hier ist jede Zahl geraten —
    // ausser der Summe der NOCH NICHT begonnenen Schritte, und die ist dann
    // eine Untergrenze.
    ueberfaellig = true;
  } else {
    summe += laufendDauer - laufendSeitS;
  }

  // Die noch nicht begonnenen Schritte: ihre volle gemessene Dauer.
  for (const schritt of offen.slice(1)) {
    const dauer = dauerVon(schritt);
    if (dauer === null) {
      luecke = true;
      continue;
    }
    summe += dauer;
  }

  if (ueberfaellig) {
    return { sekunden: Math.round(summe), grund: 'ueberfaellig' };
  }
  if (luecke) {
    // Ohne EINEN einzigen Erfahrungswert gibt es keine Untergrenze, die etwas
    // aussagt. „Mindestens 0 Minuten" ist keine Auskunft, sondern Zierde.
    if (summe <= 0) return { sekunden: null, grund: 'unbekannt' };
    return { sekunden: Math.round(summe), grund: 'mindestens' };
  }
  return { sekunden: Math.round(summe), grund: 'geschaetzt' };
}

/**
 * Sekunden als Text, wie ihn jemand neben dem Fahrzeug lesen will.
 *
 * Gerundet und grob: bei einem Bau, der Stunden dauert, ist „2 Std. 15 Min."
 * die nützliche Auskunft und „2 Std. 14 Min. 37 Sek." eine Genauigkeit, die
 * der Schätzung gar nicht zusteht.
 */
export function dauerText(sekunden: number): string {
  if (sekunden < 60) return 'weniger als 1 Min.';
  const minutenGesamt = Math.round(sekunden / 60);
  const stunden = Math.floor(minutenGesamt / 60);
  const minuten = minutenGesamt % 60;
  if (stunden === 0) return `${minuten} Min.`;
  if (minuten === 0) return `${stunden} Std.`;
  return `${stunden} Std. ${minuten} Min.`;
}

/**
 * Der ganze Satz zur Restzeit — oder keiner.
 *
 * Die Wortwahl trägt den `grund`: „noch etwa" ist eine Schätzung,
 * „mindestens noch" eine Untergrenze. Beides in dieselben Worte zu kleiden,
 * hiesse, die Unterscheidung wegzuwerfen, für die es diese Datei gibt.
 */
export function restText(auskunft: Restauskunft): string | null {
  if (auskunft.sekunden === null) return null;
  switch (auskunft.grund) {
    case 'geschaetzt':
      return auskunft.sekunden <= 0 ? 'gleich fertig' : `noch etwa ${dauerText(auskunft.sekunden)}`;
    case 'mindestens':
      return `mindestens noch ${dauerText(auskunft.sekunden)} (ein Schritt läuft zum ersten Mal)`;
    case 'ueberfaellig':
      return auskunft.sekunden <= 0
        ? 'dauert länger als beim letzten Mal'
        : `dauert länger als beim letzten Mal, danach noch etwa ${dauerText(auskunft.sekunden)}`;
    case 'unbekannt':
      return null;
  }
}
