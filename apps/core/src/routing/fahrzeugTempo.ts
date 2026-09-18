/**
 * Was DIESES Fahrzeug fahren darf — nicht, was auf dem Schild steht.
 *
 * ─── DER FALL, UM DEN ES GEHT ───────────────────────────────────────────────
 * Valhalla liefert das AUSGESCHILDERTE Tempolimit. Das ist das Limit für
 * einen PKW. Ein Wohnmobil über 3,5 t darf in Deutschland aber weniger, und
 * zwar unabhängig davon, ob ein Schild dasteht.
 *
 * Auf einer deutschen Autobahn ohne Begrenzung meldet Valhalla „unlimited".
 * `binary_sensor.yapaja_speeding` blieb damit bei 130 km/h aus — für ein
 * schweres Wohnmobil eine Übertretung um fünfzig. Die Anzeige war also nicht
 * nur unvollständig, sie war beruhigend, wo sie es nicht sein durfte.
 *
 * ─── WARUM DIE ZAHLEN HIER STEHEN UND NICHT IM CODE VERSTREUT ───────────────
 * Weil sie GEPRÜFT und KORRIGIERT werden müssen. Eine Tempogrenze ist eine
 * Rechtsfrage, keine Programmierfrage. Sie gehört an eine Stelle, die man
 * findet, liest und ändert, ohne den Rest zu verstehen.
 *
 * ─── UND WARUM SIE MIT VORBEHALT DASTEHEN ───────────────────────────────────
 * Diese Tabelle ist meine beste Lesart der StVO und ausdrücklich KEINE
 * Rechtsauskunft. Am wenigsten sicher bin ich beim Fall „über 3,5 t bis
 * 7,5 t auf der Autobahn": dort hängt es an der Einstufung des Fahrzeugs in
 * den Papieren und an einer etwaigen Tempo-100-Zulassung.
 *
 * Deshalb ist `tempo_100` eine Angabe des Betreibers und keine Vermutung, und
 * deshalb gibt es `FAHRZEUG_GRENZEN` als eine einzige benannte Tabelle: wer
 * seine Papiere danebenlegt und eine Zahl anders findet, ändert genau sie.
 *
 * ─── WARUM NUR ZWEI STRASSENARTEN ───────────────────────────────────────────
 * Valhalla kennt acht Klassen (Motorway, Trunk, Primary, Secondary, Tertiary,
 * Unclassified, Residential, ServiceOther — nachgelesen in
 * `baldr/graphconstants.h`). Es sagt aber NICHT, ob man innerorts ist.
 *
 * Das ist hier unerheblich, und zwar aus einem Grund, der sich nachrechnen
 * lässt: innerorts gilt 50, und 50 ist niedriger als JEDE Fahrzeuggrenze in
 * dieser Tabelle. Wo innerorts etwas gilt, entscheidet also ohnehin das
 * Schild. Die Fahrzeuggrenze bindet nur außerorts — und dort reichen zwei
 * Fälle: Autobahn und alles andere.
 */

/** Die Angaben aus dem Fahrzeugprofil, die für die Tempogrenze zählen. */
export interface FahrzeugAngaben {
  /** Zulässige Gesamtmasse in Tonnen. */
  weight_t: number;
  /**
   * Hat das Fahrzeug eine Tempo-100-Zulassung?
   *
   * Eine Angabe aus den Fahrzeugpapieren, keine Ableitung. Yapaia kann das
   * nicht wissen, und es zu raten wäre genau die Art Zahl, für die eine
   * Software nicht geradestehen kann.
   */
  tempo_100: boolean;
}

/**
 * Die Gewichtsklassen, nach denen sich die Grenzen richten.
 *
 * Die Schwellen sind die der StVO: 3,5 t und 7,5 t zulässige Gesamtmasse.
 */
export const SCHWELLE_LEICHT_T = 3.5;
export const SCHWELLE_MITTEL_T = 7.5;

export type Gewichtsklasse = 'bis_3_5' | 'ueber_3_5_bis_7_5' | 'ueber_7_5';

export function gewichtsklasse(weight_t: number): Gewichtsklasse {
  // `<=` an beiden Schwellen: 3,5 t selbst zählt noch zur leichten Klasse.
  // „über 3,5 t" heisst über, nicht ab.
  if (weight_t <= SCHWELLE_LEICHT_T) return 'bis_3_5';
  if (weight_t <= SCHWELLE_MITTEL_T) return 'ueber_3_5_bis_7_5';
  return 'ueber_7_5';
}

/** Eine Grenze je Straßenart. `null` heisst „keine eigene Grenze". */
export interface Grenzen {
  /** Autobahn. `null` = für dieses Fahrzeug gilt dort keine feste Grenze. */
  autobahn: number | null;
  /** Alles außerorts, was keine Autobahn ist. */
  sonst: number | null;
}

/**
 * Die Grenzen je Gewichtsklasse, in km/h.
 *
 * KEINE RECHTSAUSKUNFT — siehe Kopf dieser Datei. Wer seine Papiere
 * danebenlegt und eine Zahl anders findet, ändert sie hier.
 */
export const FAHRZEUG_GRENZEN: Record<
  Gewichtsklasse,
  { ohne_tempo_100: Grenzen; mit_tempo_100: Grenzen }
> = {
  // Bis 3,5 t ist ein Wohnmobil ein PKW: außerorts 100, auf der Autobahn
  // keine feste Grenze (die Richtgeschwindigkeit von 130 ist eine Empfehlung
  // und keine Grenze — sie hier einzutragen hiesse, eine Empfehlung als
  // Übertretung zu melden).
  //
  // Eine Tempo-100-Zulassung ändert für diese Klasse nichts; sie betrifft
  // schwerere Fahrzeuge und Gespanne.
  bis_3_5: {
    ohne_tempo_100: { autobahn: null, sonst: 100 },
    mit_tempo_100: { autobahn: null, sonst: 100 },
  },
  // Über 3,5 t bis 7,5 t: außerorts 80. Auf der Autobahn ist das der Fall,
  // bei dem ich am wenigsten sicher bin — deshalb entscheidet hier die
  // Angabe des Betreibers und nicht meine Lesart.
  ueber_3_5_bis_7_5: {
    ohne_tempo_100: { autobahn: 80, sonst: 80 },
    mit_tempo_100: { autobahn: 100, sonst: 80 },
  },
  // Über 7,5 t: außerorts 60, Autobahn 80.
  ueber_7_5: {
    ohne_tempo_100: { autobahn: 80, sonst: 60 },
    mit_tempo_100: { autobahn: 80, sonst: 60 },
  },
};

/** Valhallas Straßenklassen, gelesen in `baldr/graphconstants.h`. */
export const STRASSENKLASSEN = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service_other',
] as const;

export type Strassenklasse = (typeof STRASSENKLASSEN)[number];

/**
 * Die Tempogrenze dieses Fahrzeugs auf dieser Straßenart, oder `null`.
 *
 * `null` heisst „für dieses Fahrzeug gilt hier keine eigene Grenze" — dann
 * entscheidet allein das Schild. Es heisst NICHT „unbekannt": eine unbekannte
 * Straßenart führt ebenfalls zu `null`, und beides läuft auf dasselbe hinaus,
 * nämlich dass Yapaia hier nichts Eigenes zu sagen hat.
 */
export function fahrzeugGrenze(
  fahrzeug: FahrzeugAngaben,
  klasse: Strassenklasse | null,
): number | null {
  if (!Number.isFinite(fahrzeug.weight_t) || fahrzeug.weight_t <= 0) return null;
  if (klasse === null) return null;

  const satz = FAHRZEUG_GRENZEN[gewichtsklasse(fahrzeug.weight_t)];
  const grenzen = fahrzeug.tempo_100 ? satz.mit_tempo_100 : satz.ohne_tempo_100;
  return klasse === 'motorway' ? grenzen.autobahn : grenzen.sonst;
}

/** Woher die massgebliche Zahl kommt. */
export type Tempoquelle = 'schild' | 'fahrzeug' | 'keine';

export interface MassgeblichesTempo {
  /** Die Zahl, ab der zu schnell gefahren wird. `null` = keine bekannt. */
  grenze: number | null;
  /** Welche der beiden Zahlen entscheidet. */
  quelle: Tempoquelle;
  /** Das ausgeschilderte Limit, unverändert. */
  schild: number | null;
  /** Die Fahrzeuggrenze, unverändert. */
  fahrzeug: number | null;
}

/**
 * Welche der beiden Zahlen gilt — und beide bleiben sichtbar.
 *
 * ─── WARUM BEIDE ────────────────────────────────────────────────────────────
 * So gewünscht, und aus gutem Grund: auf einer Autobahn ohne Begrenzung
 * stünde sonst „80" auf einem runden Schild, das es dort gar nicht gibt. Wer
 * das sieht, sucht das Schild am Straßenrand und findet keines.
 *
 * Getrennt gezeigt sagt die Anzeige zwei verschiedene Dinge: was
 * ausgeschildert ist, und was für dieses Fahrzeug gilt. Gewarnt wird ab der
 * niedrigeren — aber niemand muss raten, welche Zahl woher kommt.
 *
 * ─── DER GLEICHSTAND IST BEWUSST DEM SCHILD ZUGESCHLAGEN ────────────────────
 * Sind beide gleich, steht `quelle: 'schild'`. Das ist die Zahl, die man
 * draussen sieht, und damit die, auf die sich ein Gespräch am Strassenrand
 * bezieht.
 */
export function massgeblichesTempo(
  schild: number | null,
  fahrzeug: number | null,
): MassgeblichesTempo {
  if (schild === null && fahrzeug === null) {
    return { grenze: null, quelle: 'keine', schild: null, fahrzeug: null };
  }
  if (schild === null) {
    return { grenze: fahrzeug, quelle: 'fahrzeug', schild: null, fahrzeug };
  }
  if (fahrzeug === null) {
    return { grenze: schild, quelle: 'schild', schild, fahrzeug: null };
  }
  return fahrzeug < schild
    ? { grenze: fahrzeug, quelle: 'fahrzeug', schild, fahrzeug }
    : { grenze: schild, quelle: 'schild', schild, fahrzeug };
}

/**
 * Fährt dieses Fahrzeug gerade zu schnell?
 *
 * Nur `true`, wenn BEIDES bekannt ist. Eine unbekannte Grenze ist keine
 * Übertretung, und ein unbekanntes Tempo erst recht nicht — dieselbe Regel
 * wie bisher in `buildSpeedPayload`, nur dass jetzt auch die Fahrzeuggrenze
 * zählen kann.
 */
export function faehrtZuSchnell(tempo: number | null, grenze: number | null): boolean {
  if (tempo === null || grenze === null) return false;
  if (!Number.isFinite(tempo) || !Number.isFinite(grenze)) return false;
  return tempo > grenze;
}
