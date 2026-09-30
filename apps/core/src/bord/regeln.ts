/**
 * Bordsensoren: wann ein Hinweis fällig ist.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Idee 4 aus `docs/ideen-ki.md`: das Wohnmobil meldet sich, BEVOR man am
 * Stellplatz merkt, dass der Grauwassertank voll ist. Home Assistant kennt die
 * Füllstände; Yapaia kennt die Route und die Entsorgungsstationen darauf.
 *
 * Diese Stufe ist bewusst OHNE KI: Schwellwerte und eine Suche entlang der
 * Route. Das deckt die häufigen Fälle ab, ist vorhersagbar und läuft offline.
 * Die KI kommt später dazu, wenn mehrere Werte zusammen eine Empfehlung
 * ergeben.
 *
 * ─── WARUM MIT HYSTERESE ────────────────────────────────────────────────────
 * Ein Füllstandssensor im fahrenden Fahrzeug schwappt. Bei einer Schwelle von
 * 80 % und einem Wert, der zwischen 79 und 81 pendelt, erschiene der Hinweis
 * jede Minute neu -- genau die Sorte Tapete, die beim Verkehrshinweis gemeldet
 * wurde. Deshalb: AN bei Erreichen der Schwelle, AUS erst, wenn der Wert um
 * {@link HYSTERESE} zurückgegangen ist (Tank geleert, Wasser aufgefüllt).
 */

/** Um so viel muss ein Wert zurück, bevor ein Hinweis wieder erlischt. */
export const HYSTERESE = {
  /** Prozentpunkte bei Füllständen und Ladezustand. */
  prozent: 5,
  /** Grad bei der Außentemperatur. */
  grad: 2,
} as const;

export type BordArt = 'grauwasser' | 'frischwasser' | 'batterie' | 'frost';

/** Was die Sensoren gerade sagen. `null` = unbekannt oder nicht eingerichtet. */
export interface BordWerte {
  grauwasser_prozent: number | null;
  frischwasser_prozent: number | null;
  batterie_prozent: number | null;
  aussentemperatur_c: number | null;
}

export interface BordSchwellen {
  /** Grauwasser AB diesem Füllstand melden. */
  grauwasser_ab_prozent: number;
  /** Frischwasser BIS zu diesem Füllstand melden. */
  frischwasser_bis_prozent: number;
  /** Batterie BIS zu diesem Ladezustand melden. */
  batterie_bis_prozent: number;
  /** Frost AB dieser Temperatur (und darunter) melden. */
  frost_bis_c: number;
}

export const STANDARD_SCHWELLEN: BordSchwellen = {
  grauwasser_ab_prozent: 80,
  frischwasser_bis_prozent: 20,
  batterie_bis_prozent: 30,
  frost_bis_c: 1,
};

/** Welche Sonderziel-Kategorie zu einem Hinweis passt (`@yapaia/shared` FEHLENDE_KLASSEN). */
export const PASSENDE_STATION: Partial<Record<BordArt, string>> = {
  grauwasser: 'sanitary_dump_station',
  frischwasser: 'water_point',
};

export interface BordBefund {
  art: BordArt;
  /** Der Wert, der ihn ausgelöst hat -- für die Anzeige. */
  wert: number;
  /** Ein Satz, zum Anzeigen und zum Vorlesen. */
  text: string;
}

/** Welche Hinweise gerade aktiv sind -- der Zustand für die Hysterese. */
export type AktiveArten = ReadonlySet<BordArt>;

function zahl(x: number | null): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Ein Hinweis, der nach OBEN auslöst (Grauwasser): an bei `wert >= schwelle`,
 * aus erst bei `wert < schwelle - hysterese`.
 */
function obenAktiv(wert: number, schwelle: number, hysterese: number, warAktiv: boolean): boolean {
  return warAktiv ? wert >= schwelle - hysterese : wert >= schwelle;
}

/** Spiegelbildlich für Werte, die nach UNTEN auslösen (Frischwasser, Batterie, Frost). */
function untenAktiv(wert: number, schwelle: number, hysterese: number, warAktiv: boolean): boolean {
  return warAktiv ? wert <= schwelle + hysterese : wert <= schwelle;
}

function prozent(x: number): string {
  return `${Math.round(x)} %`;
}

/**
 * Die Hinweise, die jetzt gelten.
 *
 * `vorher` sind die Arten, die beim letzten Aufruf aktiv waren -- daraus
 * entsteht die Hysterese. Ein unbekannter Wert (`null`, NaN) löst nie etwas
 * aus und lässt einen aktiven Hinweis erlöschen: lieber nichts sagen als etwas
 * behaupten, das ein ausgefallener Sensor nicht mehr stützt.
 */
export function bordBefunde(
  werte: BordWerte,
  schwellen: BordSchwellen,
  vorher: AktiveArten = new Set(),
): BordBefund[] {
  const raus: BordBefund[] = [];

  const grau = werte.grauwasser_prozent;
  if (zahl(grau) && obenAktiv(grau, schwellen.grauwasser_ab_prozent, HYSTERESE.prozent, vorher.has('grauwasser'))) {
    raus.push({ art: 'grauwasser', wert: grau, text: `Grauwasser bei ${prozent(grau)}.` });
  }

  const frisch = werte.frischwasser_prozent;
  if (
    zahl(frisch) &&
    untenAktiv(frisch, schwellen.frischwasser_bis_prozent, HYSTERESE.prozent, vorher.has('frischwasser'))
  ) {
    raus.push({ art: 'frischwasser', wert: frisch, text: `Frischwasser nur noch ${prozent(frisch)}.` });
  }

  const batt = werte.batterie_prozent;
  if (zahl(batt) && untenAktiv(batt, schwellen.batterie_bis_prozent, HYSTERESE.prozent, vorher.has('batterie'))) {
    raus.push({
      art: 'batterie',
      wert: batt,
      text: `Bordbatterie bei ${prozent(batt)} — für die Nacht besser einen Platz mit Strom.`,
    });
  }

  const temp = werte.aussentemperatur_c;
  if (zahl(temp) && untenAktiv(temp, schwellen.frost_bis_c, HYSTERESE.grad, vorher.has('frost'))) {
    raus.push({
      art: 'frost',
      wert: temp,
      text: `Außen ${temp.toFixed(1).replace('.', ',')} °C — Frostschutz für die Wasseranlage prüfen.`,
    });
  }

  return raus;
}

/**
 * Einen HA-Zustand als Zahl lesen.
 *
 * Home Assistant liefert Zustände als TEXT, und für „weiß ich nicht"
 * `unknown` oder `unavailable`. Beides ist `null`, nicht 0 -- eine 0 beim
 * Frischwasser wäre ein Hinweis auf einen leeren Tank, den es nicht gibt.
 */
export function haZahl(zustand: string | undefined | null): number | null {
  if (typeof zustand !== 'string') return null;
  const t = zustand.trim().replace(',', '.');
  if (t === '' || t === 'unknown' || t === 'unavailable') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
