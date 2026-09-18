/**
 * Die Restzeit des Gesamtbaus.
 *
 * ─── DIE LEITFRAGE ──────────────────────────────────────────────────────────
 * Sieht „ich weiss es nicht" jemals aus wie „gleich fertig"?
 *
 * Wer neben dem Wohnmobil steht und auf eine Zahl schaut, trifft danach eine
 * Entscheidung: warten oder etwas anderes anfangen. Eine Untergrenze, die wie
 * eine Schätzung aussieht, führt zu genau der falschen — sie fällt immer zu
 * kurz aus.
 */

import { describe, it, expect } from 'vitest';
import {
  restdauer,
  restText,
  dauerText,
  schluessel,
  routingSchluessel,
  type Bauschritt,
  type Bauerfahrung,
} from './bauzeit.js';

const REGIONEN = ['germany', 'liechtenstein'];

/** Der übliche Plan: erst das Routing, dann je Region die Suche. */
const PLAN: Bauschritt[] = [
  { bauart: 'routing', region: 'germany' },
  { bauart: 'suche', region: 'germany' },
  { bauart: 'suche', region: 'liechtenstein' },
];

/** Erfahrung für alle drei Schritte. */
function volleErfahrung(): Bauerfahrung {
  return {
    [routingSchluessel(REGIONEN)]: 1800, // 30 Min.
    'suche:germany': 600, // 10 Min.
    'suche:liechtenstein': 60, // 1 Min.
  };
}

function frage(
  erledigt: number,
  laufendSeitMs: number,
  erfahrung: Bauerfahrung = volleErfahrung(),
): ReturnType<typeof restdauer> {
  return restdauer({ plan: PLAN, erledigt, laufendSeitMs, erfahrung, alleRegionen: REGIONEN });
}

describe('der Schlüssel eines Schritts', () => {
  it('die Suche hängt an ihrer Region', () => {
    expect(schluessel({ bauart: 'suche', region: 'germany' }, REGIONEN)).toBe('suche:germany');
  });

  it('das Routing hängt an ALLEN Regionen, nicht an der angeklickten', () => {
    // ─── WARUM DAS WICHTIG IST ──────────────────────────────────────────────
    // Ein Routingbau deckt alle installierten Karten ab. Seine Dauer haengt
    // an deren Menge, nicht daran, unter welchem Eintrag der Knopf sass.
    const a = schluessel({ bauart: 'routing', region: 'germany' }, REGIONEN);
    const b = schluessel({ bauart: 'routing', region: 'liechtenstein' }, REGIONEN);
    expect(a).toBe(b);
  });

  it('die Reihenfolge der Regionen ändert den Schlüssel nicht', () => {
    // Sonst haetten dieselben Karten je nach Sortierung des Dateisystems
    // mal einen Erfahrungswert und mal keinen.
    expect(routingSchluessel(['germany', 'liechtenstein'])).toBe(
      routingSchluessel(['liechtenstein', 'germany']),
    );
  });

  it('eine Karte mehr ergibt einen ANDEREN Schlüssel', () => {
    // Die Gegenprobe: waere der Schluessel gleich, bekaeme ein Bau ueber drei
    // Laender die gemessene Dauer von zweien angeboten.
    expect(routingSchluessel(['germany', 'liechtenstein'])).not.toBe(
      routingSchluessel(['germany', 'liechtenstein', 'austria']),
    );
  });
});

describe('mit Erfahrung für jeden Schritt', () => {
  it('am Anfang ist es die Summe aller drei', () => {
    expect(frage(0, 0)).toEqual({ sekunden: 1800 + 600 + 60, grund: 'geschaetzt' });
  });

  it('die Zahl sinkt, während der erste Schritt läuft', () => {
    // Das ist die Forderung „sollte sich entsprechend des Bau-Fortschritts
    // aktualisieren" -- nachgeprueft und nicht nur behauptet.
    expect(frage(0, 600_000).sekunden).toBe(1800 - 600 + 600 + 60);
  });

  it('nach dem ersten Schritt fällt dessen Zeit ganz weg', () => {
    expect(frage(1, 0)).toEqual({ sekunden: 660, grund: 'geschaetzt' });
  });

  it('beim letzten Schritt zählt nur noch dieser', () => {
    expect(frage(2, 0)).toEqual({ sekunden: 60, grund: 'geschaetzt' });
  });

  it('alles erledigt heisst null Sekunden, nicht `unbekannt`', () => {
    expect(frage(3, 0)).toEqual({ sekunden: 0, grund: 'geschaetzt' });
  });

  it('ein erledigt-Wert über den Plan hinaus ist auch fertig', () => {
    // Kann durch einen Zaehlfehler entstehen. Er darf nicht in eine negative
    // Restzeit muenden.
    expect(frage(99, 0).sekunden).toBe(0);
  });
});

describe('wenn ein Schritt zum ersten Mal läuft', () => {
  it('ohne Erfahrung für den laufenden Schritt: UNTERGRENZE, nicht Schätzung', () => {
    // ─── DER KERN DIESER DATEI ──────────────────────────────────────────────
    // Die beiden Suchschritte sind bekannt, das Routing nicht. 11 Minuten
    // sind dann alles andere als eine Schaetzung: der unbekannte Schritt
    // kann eine halbe Stunde dauern. Als „noch etwa 11 Min." waere das die
    // gefaehrlichere Auskunft -- sie faellt immer zu kurz aus.
    const ohneRouting = { 'suche:germany': 600, 'suche:liechtenstein': 60 };
    expect(frage(0, 0, ohneRouting)).toEqual({ sekunden: 660, grund: 'mindestens' });
  });

  it('ohne Erfahrung für einen SPÄTEREN Schritt: ebenfalls Untergrenze', () => {
    const ohneLiechtenstein = {
      [routingSchluessel(REGIONEN)]: 1800,
      'suche:germany': 600,
    };
    expect(frage(0, 0, ohneLiechtenstein)).toEqual({ sekunden: 2400, grund: 'mindestens' });
  });

  it('gar keine Erfahrung: gar keine Zahl', () => {
    // Nicht „mindestens 0 Min." -- das waere Zierde, keine Auskunft.
    expect(frage(0, 0, {})).toEqual({ sekunden: null, grund: 'unbekannt' });
  });

  it('eine Dauer von 0 zählt wie keine', () => {
    // Ein solcher Wert kann nur aus einer kaputten Messung stammen. Ihn zu
    // verwenden hiesse, „sofort fertig" zu behaupten.
    expect(frage(2, 0, { 'suche:liechtenstein': 0 })).toEqual({
      sekunden: null,
      grund: 'unbekannt',
    });
  });

  it('eine negative oder unsinnige Dauer zählt ebenfalls nicht', () => {
    expect(frage(2, 0, { 'suche:liechtenstein': -5 }).grund).toBe('unbekannt');
    expect(frage(2, 0, { 'suche:liechtenstein': Number.NaN }).grund).toBe('unbekannt');
  });
});

describe('wenn es länger dauert als beim letzten Mal', () => {
  it('der laufende Schritt ist überfällig — die Restzeit sagt das', () => {
    // ─── WARUM DAS EINEN EIGENEN GRUND BEKOMMT ──────────────────────────────
    // Eine Restzeit, die bei „0 Min." stehenbleibt und sich nicht mehr
    // ruehrt, sieht aus wie ein Haenger. Genau dann will jemand wissen, ob
    // er abbrechen soll.
    const jetzt = frage(0, 1800_000 + 1000);
    expect(jetzt.grund).toBe('ueberfaellig');
    // Die noch nicht begonnenen Schritte bleiben als Untergrenze stehen.
    expect(jetzt.sekunden).toBe(660);
  });

  it('genau auf der gemessenen Dauer gilt schon als überfällig', () => {
    expect(frage(0, 1800_000).grund).toBe('ueberfaellig');
  });

  it('eine Sekunde davor ist es noch eine Schätzung', () => {
    // Die Gegenprobe: ein `ueberfaellig`, das immer gilt, waere so wertlos
    // wie eines, das nie gilt.
    const knapp = frage(0, 1799_000);
    expect(knapp.grund).toBe('geschaetzt');
    expect(knapp.sekunden).toBe(1 + 660);
  });

  it('überfällig im LETZTEN Schritt: nichts mehr dahinter', () => {
    const jetzt = frage(2, 120_000);
    expect(jetzt).toEqual({ sekunden: 0, grund: 'ueberfaellig' });
  });
});

describe('die Zeit selbst', () => {
  it('eine negative Laufzeit wird wie null behandelt', () => {
    // Uhren springen. Eine Restzeit, die dadurch WAECHST, waere Unsinn.
    expect(frage(0, -60_000).sekunden).toBe(2460);
  });
});

describe('dauerText', () => {
  it.each([
    [0, 'weniger als 1 Min.'],
    [59, 'weniger als 1 Min.'],
    [60, '1 Min.'],
    [90, '2 Min.'],
    [600, '10 Min.'],
    [3600, '1 Std.'],
    [3660, '1 Std. 1 Min.'],
    [8100, '2 Std. 15 Min.'],
  ])('%i Sekunden -> %s', (sekunden, erwartet) => {
    expect(dauerText(sekunden)).toBe(erwartet);
  });

  it('rundet auf volle Minuten, statt Sekunden vorzutäuschen', () => {
    // Eine Schaetzung auf die Sekunde genau anzugeben, behauptet eine
    // Genauigkeit, die ihr nicht zusteht.
    expect(dauerText(877)).toBe('15 Min.');
  });
});

describe('restText', () => {
  it('eine Schätzung heisst „noch etwa"', () => {
    expect(restText({ sekunden: 600, grund: 'geschaetzt' })).toBe('noch etwa 10 Min.');
  });

  it('eine Untergrenze heisst „mindestens" — und sagt auch warum', () => {
    const text = restText({ sekunden: 600, grund: 'mindestens' });
    expect(text).toContain('mindestens');
    expect(text, 'ohne den Grund liest sich die Untergrenze wie Willkür').toContain(
      'zum ersten Mal',
    );
  });

  it('die beiden sind NICHT derselbe Satz', () => {
    // Die Gegenprobe zur ganzen Datei: waeren sie gleich, koennte man sich
    // den `grund` sparen.
    expect(restText({ sekunden: 600, grund: 'geschaetzt' })).not.toBe(
      restText({ sekunden: 600, grund: 'mindestens' }),
    );
  });

  it('überfällig wird benannt, nicht in eine Zahl gekleidet', () => {
    expect(restText({ sekunden: 660, grund: 'ueberfaellig' })).toContain(
      'dauert länger als beim letzten Mal',
    );
  });

  it('überfällig ohne Rest: nur die Lage, keine Zahl', () => {
    expect(restText({ sekunden: 0, grund: 'ueberfaellig' })).toBe(
      'dauert länger als beim letzten Mal',
    );
  });

  it('`unbekannt` ergibt GAR KEINEN Satz', () => {
    // Kein „noch unbekannt lange" -- die Oberflaeche sagt es mit eigenen
    // Worten, und zwar an der Stelle, an der sie den Fortschritt erklaert.
    expect(restText({ sekunden: null, grund: 'unbekannt' })).toBeNull();
  });

  it('fertig heisst „gleich fertig", nicht „noch etwa 0 Min."', () => {
    expect(restText({ sekunden: 0, grund: 'geschaetzt' })).toBe('gleich fertig');
  });
});
