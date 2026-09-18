/**
 * Die Tempogrenze dieses Fahrzeugs — und wann Yapaia lieber schweigt.
 *
 * ─── WAS HIER GEPRÜFT WIRD UND WAS NICHT ────────────────────────────────────
 * Geprüft wird die RECHNUNG: dass aus Gewicht, Tempo-100-Zulassung und
 * Straßenart genau die Zahl wird, die in `FAHRZEUG_GRENZEN` steht, und dass
 * bei zwei bekannten Zahlen die niedrigere gilt.
 *
 * NICHT geprüft wird, ob die Zahlen in jener Tabelle rechtlich stimmen. Das
 * kann kein Test; es steht als Vorbehalt in der Datei selbst. Diese Trennung
 * ist Absicht — ein grüner Test darf nicht wie eine Rechtsauskunft aussehen.
 */

import { describe, it, expect } from 'vitest';
import {
  fahrzeugGrenze,
  massgeblichesTempo,
  faehrtZuSchnell,
  gewichtsklasse,
  FAHRZEUG_GRENZEN,
  STRASSENKLASSEN,
  SCHWELLE_LEICHT_T,
  SCHWELLE_MITTEL_T,
  type Strassenklasse,
} from './fahrzeugTempo.js';

const LEICHT = { weight_t: 3.2, tempo_100: false };
const SCHWER = { weight_t: 5.0, tempo_100: false };
const SCHWER_100 = { weight_t: 5.0, tempo_100: true };
const SEHR_SCHWER = { weight_t: 9.0, tempo_100: false };

describe('gewichtsklasse — die Schwellen der StVO', () => {
  it('3,5 t selbst zählt noch zur leichten Klasse', () => {
    // „über 3,5 t" heisst über, nicht ab. Ein Fahrzeug mit genau 3,5 t
    // zulässiger Gesamtmasse ist der häufigste Fall überhaupt — hier
    // danebenzugreifen hiesse, die halbe Zielgruppe falsch einzustufen.
    expect(gewichtsklasse(SCHWELLE_LEICHT_T)).toBe('bis_3_5');
    expect(gewichtsklasse(3.51)).toBe('ueber_3_5_bis_7_5');
  });

  it('7,5 t selbst zählt noch zur mittleren Klasse', () => {
    expect(gewichtsklasse(SCHWELLE_MITTEL_T)).toBe('ueber_3_5_bis_7_5');
    expect(gewichtsklasse(7.51)).toBe('ueber_7_5');
  });

  it('die drei Klassen decken den ganzen Bereich des Profils ab', () => {
    // Das Schema lässt 1,0 bis 40,0 t zu.
    for (const t of [1, 3.5, 3.6, 7.5, 7.6, 40]) {
      expect(FAHRZEUG_GRENZEN[gewichtsklasse(t)], `${t} t`).toBeDefined();
    }
  });
});

describe('fahrzeugGrenze — was dieses Fahrzeug darf', () => {
  it('bis 3,5 t gilt auf der Autobahn KEINE feste Grenze', () => {
    // Die Richtgeschwindigkeit von 130 ist eine Empfehlung. Sie hier als
    // Grenze zu führen hiesse, eine Empfehlung als Übertretung zu melden —
    // und damit eine Warnung zu erzeugen, die rechtlich keine ist.
    expect(fahrzeugGrenze(LEICHT, 'motorway')).toBeNull();
  });

  it('bis 3,5 t außerorts 100', () => {
    expect(fahrzeugGrenze(LEICHT, 'primary')).toBe(100);
  });

  it('über 3,5 t ohne Tempo-100: Autobahn 80', () => {
    // Der gemeldete Fall: auf einer unbegrenzten Autobahn meldete Yapaia bei
    // 130 km/h nichts, weil es nur das Schild kannte.
    expect(fahrzeugGrenze(SCHWER, 'motorway')).toBe(80);
  });

  it('über 3,5 t MIT Tempo-100: Autobahn 100, außerorts weiterhin 80', () => {
    // Die Zulassung hebt nur die Autobahn an. Das ist genau der Punkt, an dem
    // eine Angabe des Betreibers nötig ist — Yapaia kann sie nicht wissen.
    expect(fahrzeugGrenze(SCHWER_100, 'motorway')).toBe(100);
    expect(fahrzeugGrenze(SCHWER_100, 'primary')).toBe(80);
  });

  it('Tempo-100 ändert für ein leichtes Fahrzeug nichts', () => {
    // Die Gegenprobe: wer das Häkchen irrtümlich setzt, bekommt deswegen
    // keine andere Zahl.
    expect(fahrzeugGrenze({ weight_t: 3.2, tempo_100: true }, 'motorway')).toBeNull();
    expect(fahrzeugGrenze({ weight_t: 3.2, tempo_100: true }, 'primary')).toBe(100);
  });

  it('über 7,5 t: Autobahn 80, außerorts 60', () => {
    expect(fahrzeugGrenze(SEHR_SCHWER, 'motorway')).toBe(80);
    expect(fahrzeugGrenze(SEHR_SCHWER, 'primary')).toBe(60);
  });

  it('alle Straßenarten ausser motorway werden gleich behandelt', () => {
    // ─── DIE VEREINFACHUNG, DIE HIER GEPRÜFT WIRD ───────────────────────────
    // Valhalla sagt nicht, ob man innerorts ist. Das ist unerheblich, weil
    // innerorts 50 gilt und 50 unter JEDER Fahrzeuggrenze liegt — dort
    // entscheidet also ohnehin das Schild.
    const ohneAutobahn = STRASSENKLASSEN.filter((k) => k !== 'motorway');
    for (const klasse of ohneAutobahn) {
      expect(fahrzeugGrenze(SCHWER, klasse), klasse).toBe(80);
    }
    expect(ohneAutobahn.length).toBe(7);
  });

  it('ohne Straßenart gibt es keine Grenze', () => {
    expect(fahrzeugGrenze(SCHWER, null)).toBeNull();
  });

  it('ein unsinniges Gewicht führt zu keiner Grenze statt zu einer falschen', () => {
    for (const t of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fahrzeugGrenze({ weight_t: t, tempo_100: false }, 'motorway'), `${t}`).toBeNull();
    }
  });
});

describe('massgeblichesTempo — beide Zahlen bleiben sichtbar', () => {
  it('die niedrigere entscheidet, die andere bleibt stehen', () => {
    const t = massgeblichesTempo(130, 80);
    expect(t).toEqual({ grenze: 80, quelle: 'fahrzeug', schild: 130, fahrzeug: 80 });
  });

  it('ein niedrigeres Schild schlägt die Fahrzeuggrenze', () => {
    // Baustelle mit 60 auf der Autobahn: das Schild gilt, obwohl das
    // Fahrzeug 80 dürfte.
    expect(massgeblichesTempo(60, 80)).toMatchObject({ grenze: 60, quelle: 'schild' });
  });

  it('ohne Schild gilt die Fahrzeuggrenze', () => {
    // Der wichtigste Fall: deutsche Autobahn ohne Begrenzung. Valhalla
    // meldet dort „unlimited", was bei uns `null` ist.
    expect(massgeblichesTempo(null, 80)).toMatchObject({ grenze: 80, quelle: 'fahrzeug' });
  });

  it('ohne Fahrzeuggrenze gilt das Schild', () => {
    expect(massgeblichesTempo(100, null)).toMatchObject({ grenze: 100, quelle: 'schild' });
  });

  it('ohne beides gibt es keine Grenze — und das steht auch so da', () => {
    expect(massgeblichesTempo(null, null)).toEqual({
      grenze: null,
      quelle: 'keine',
      schild: null,
      fahrzeug: null,
    });
  });

  it('bei Gleichstand gilt das Schild', () => {
    // Die Zahl, die man draussen sieht, ist die, auf die sich ein Gespräch
    // am Strassenrand bezieht.
    expect(massgeblichesTempo(80, 80)).toMatchObject({ grenze: 80, quelle: 'schild' });
  });

  it('beide Zahlen kommen unverändert mit, egal welche gilt', () => {
    // Ohne das könnte die Anzeige nicht zeigen, welche Zahl woher kommt —
    // und auf einer unbegrenzten Autobahn stünde „80" auf einem runden
    // Schild, das dort gar nicht steht.
    for (const [s, f] of [
      [130, 80],
      [60, 80],
      [null, 80],
      [100, null],
    ] as Array<[number | null, number | null]>) {
      const t = massgeblichesTempo(s, f);
      expect(t.schild).toBe(s);
      expect(t.fahrzeug).toBe(f);
    }
  });
});

describe('faehrtZuSchnell — im Zweifel keine Warnung', () => {
  it('meldet eine Übertretung', () => {
    expect(faehrtZuSchnell(95, 80)).toBe(true);
  });

  it('genau auf der Grenze ist keine Übertretung', () => {
    expect(faehrtZuSchnell(80, 80)).toBe(false);
  });

  it('ohne Grenze oder ohne Tempo wird nicht gewarnt', () => {
    // Eine unbekannte Grenze ist keine Übertretung. Dieselbe Regel wie
    // bisher — eine Warnung aus einem fehlenden Wert wäre schlimmer als
    // keine Warnung.
    expect(faehrtZuSchnell(130, null)).toBe(false);
    expect(faehrtZuSchnell(null, 80)).toBe(false);
    expect(faehrtZuSchnell(null, null)).toBe(false);
  });

  it('unsinnige Zahlen erzeugen keine Warnung', () => {
    expect(faehrtZuSchnell(Number.NaN, 80)).toBe(false);
    expect(faehrtZuSchnell(95, Number.NaN)).toBe(false);
  });
});

describe('der gemeldete Fall, von Anfang bis Ende', () => {
  it('5-t-Wohnmobil, 130 km/h, unbegrenzte Autobahn: WARNUNG', () => {
    // Vorher: `speeding` blieb aus, weil nur das Schild zählte und es keines
    // gab. Eine Übertretung um fünfzig, die als „alles in Ordnung" durchging.
    const grenze = fahrzeugGrenze(SCHWER, 'motorway' as Strassenklasse);
    const t = massgeblichesTempo(null, grenze);
    expect(t.grenze).toBe(80);
    expect(faehrtZuSchnell(130, t.grenze)).toBe(true);
  });

  it('dasselbe Fahrzeug mit Tempo-100 bei 95 km/h: keine Warnung', () => {
    const grenze = fahrzeugGrenze(SCHWER_100, 'motorway' as Strassenklasse);
    const t = massgeblichesTempo(null, grenze);
    expect(t.grenze).toBe(100);
    expect(faehrtZuSchnell(95, t.grenze)).toBe(false);
  });

  it('3,2-t-Kastenwagen, 130 km/h, unbegrenzte Autobahn: KEINE Warnung', () => {
    // Die Gegenprobe. Wer leicht genug ist, darf dort so schnell fahren —
    // eine Warnung wäre hier schlicht falsch und würde nach drei Fahrten
    // nicht mehr gelesen.
    const grenze = fahrzeugGrenze(LEICHT, 'motorway' as Strassenklasse);
    const t = massgeblichesTempo(null, grenze);
    expect(t.quelle).toBe('keine');
    expect(faehrtZuSchnell(130, t.grenze)).toBe(false);
  });
});
