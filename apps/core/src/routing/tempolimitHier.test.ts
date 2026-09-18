/**
 * Das Tempolimit an der aktuellen Stelle — und wann Yapaia lieber schweigt.
 *
 * ─── DIE LEITFRAGE ──────────────────────────────────────────────────────────
 * Kann hier eine Zahl entstehen, die falsch ist?
 *
 * Ein leeres Verkehrszeichen sagt „weiß ich nicht". Eine 100 auf einer
 * Landstraße sagt etwas Falsches mit Nachdruck, und zwar in einem Fahrzeug.
 * Die meisten Prüfungen hier drehen sich deshalb nicht um den Normalfall,
 * sondern um die Fälle, in denen NICHTS herauskommen darf.
 */

import { describe, it, expect } from 'vitest';
import type { Position } from '@yapaia/shared';
import {
  punktTauglich,
  spurPflegen,
  spurBrauchbar,
  buildSpurBody,
  limitAusSpurAntwort,
  abfrageFaellig,
  alsSpurpunkt,
  SPUR_LAENGE,
  MINDESTABSTAND_M,
  SPUR_HOECHSTALTER_MS,
  ABFRAGE_ABSTAND_MS,
  HOECHSTE_UNGENAUIGKEIT_M,
  type Spurpunkt,
} from './tempolimitHier.js';
import { speedLimitOf, roadClassOf } from './speedLimits.js';

function pos(teil: Partial<Position> = {}): Position {
  return {
    lat: 49.239,
    lon: 8.32,
    alt: 120,
    speed: 25,
    heading: 180,
    accuracy: 8,
    source: 'gpsd',
    fix: '3d',
    ts: '2026-09-18T08:00:00.000Z',
    ...teil,
  } as Position;
}

/** Ein Punkt `n` Meter nördlich von 49.239 — 1 Grad Breite ≈ 111 320 m. */
function nordlich(meter: number, ts = 0): Spurpunkt {
  return { lat: 49.239 + meter / 111_320, lon: 8.32, ts };
}

describe('punktTauglich — eine ungenaue Position ist kein Beleg', () => {
  it('nimmt eine gute Position', () => {
    expect(punktTauglich(pos())).toBe(true);
  });

  it('lehnt eine zu ungenaue ab', () => {
    // ─── DER GEMELDETE WERT ─────────────────────────────────────────────────
    // Aus dem laufenden Betrieb: `gps_accuracy: 53.2`. Auf zweiundfünfzig
    // Metern liegen Autobahn, Auffahrt und Parallelstraße nebeneinander.
    expect(punktTauglich(pos({ accuracy: 53.2 }))).toBe(false);
  });

  it('die Schwelle selbst gilt noch als brauchbar', () => {
    expect(punktTauglich(pos({ accuracy: HOECHSTE_UNGENAUIGKEIT_M }))).toBe(true);
    expect(punktTauglich(pos({ accuracy: HOECHSTE_UNGENAUIGKEIT_M + 0.1 }))).toBe(false);
  });

  it('eine FEHLENDE Genauigkeit gilt nicht als gute', () => {
    // Unbekannt heisst hier „nicht zuordnen". Ein Tempolimit aus einer
    // Position, deren Güte niemand kennt, ist geraten — und als `null`
    // durchgewinkt wäre es die grosszügigste Auslegung von allen.
    for (const a of [null, undefined, Number.NaN]) {
      expect(punktTauglich(pos({ accuracy: a as unknown as number })), String(a)).toBe(false);
    }
  });

  it('ohne Fix gibt es keinen Punkt', () => {
    expect(punktTauglich(pos({ fix: 'none' }))).toBe(false);
  });

  it('ein 2D-Fix reicht', () => {
    // Anders als bei der Höhe: für die Lage auf der Karte braucht es keinen
    // vierten Satelliten.
    expect(punktTauglich(pos({ fix: '2d' }))).toBe(true);
  });

  it('0/0 ist kein Ort', () => {
    expect(punktTauglich(pos({ lat: 0, lon: 0 }))).toBe(false);
  });

  it('ohne Position gibt es nichts', () => {
    expect(punktTauglich(null)).toBe(false);
    expect(punktTauglich(undefined)).toBe(false);
  });
});

describe('spurPflegen — eine Linie, keine Punktwolke', () => {
  it('nimmt einen Punkt auf, der weit genug weg ist', () => {
    const spur = spurPflegen([nordlich(0)], nordlich(20, 1000), 1000);
    expect(spur).toHaveLength(2);
  });

  it('verwirft einen Punkt, der zu dicht dran ist', () => {
    // ─── WARUM DAS WICHTIG IST ──────────────────────────────────────────────
    // Im Stand liefert das GPS weiter Punkte, die sich nur durch das Rauschen
    // unterscheiden. Eine Spur daraus zeigt in eine ZUFÄLLIGE Richtung — und
    // eine zufällige Richtung ordnet schlechter zu als gar keine.
    const spur = spurPflegen([nordlich(0)], nordlich(3, 1000), 1000);
    expect(spur).toHaveLength(1);
  });

  it('der Mindestabstand selbst reicht noch nicht', () => {
    const knapp = spurPflegen([nordlich(0)], nordlich(MINDESTABSTAND_M - 0.5, 1), 1);
    expect(knapp).toHaveLength(1);
    const reicht = spurPflegen([nordlich(0)], nordlich(MINDESTABSTAND_M + 0.5, 1), 1);
    expect(reicht).toHaveLength(2);
  });

  it('hält höchstens SPUR_LAENGE Punkte und wirft die ältesten weg', () => {
    let spur: Spurpunkt[] = [];
    for (let i = 0; i < SPUR_LAENGE + 3; i += 1) {
      spur = spurPflegen(spur, nordlich(i * 20, i * 1000), i * 1000);
    }
    expect(spur).toHaveLength(SPUR_LAENGE);
    // Der älteste verbliebene ist NICHT der erste — sonst wüchse die Spur
    // über mehrere Straßen.
    expect(spur[0]?.ts).toBeGreaterThan(0);
  });

  it('wirft zu alte Punkte weg', () => {
    // Wer eine Minute steht und dann losfährt, soll nicht mit einer Spur von
    // vorhin zugeordnet werden.
    const alt = nordlich(0, 0);
    const jetzt = SPUR_HOECHSTALTER_MS + 5_000;
    const spur = spurPflegen([alt], nordlich(50, jetzt), jetzt);
    expect(spur).toHaveLength(1);
    expect(spur[0]?.ts).toBe(jetzt);
  });

  it('verändert die übergebene Spur nicht', () => {
    // Rein heisst rein. Eine Funktion, die ihren Eingang nebenbei ändert,
    // macht jede Prüfung von der Aufrufreihenfolge abhängig.
    const bisher = [nordlich(0)];
    spurPflegen(bisher, nordlich(50, 1000), 1000);
    expect(bisher).toHaveLength(1);
  });
});

describe('spurBrauchbar — ohne Richtung wird nicht zugeordnet', () => {
  it('ein einzelner Punkt reicht nicht', () => {
    // Ein Punkt hat keine Richtung. Neben einer Autobahn verläuft oft eine
    // Nebenstraße, und zwischen beiden ist mit einem Punkt nicht zu
    // unterscheiden.
    expect(spurBrauchbar([nordlich(0, 1000)], 1000)).toBe(false);
  });

  it('zwei Punkte reichen', () => {
    expect(spurBrauchbar([nordlich(0, 0), nordlich(20, 1000)], 1000)).toBe(true);
  });

  it('eine Spur mit altem NEUESTEN Punkt taugt nicht mehr', () => {
    const spur = [nordlich(0, 0), nordlich(20, 1000)];
    expect(spurBrauchbar(spur, 1000 + SPUR_HOECHSTALTER_MS + 1)).toBe(false);
  });

  it('eine leere Spur taugt nicht', () => {
    expect(spurBrauchbar([], 0)).toBe(false);
  });
});

describe('buildSpurBody — was Valhalla bekommt', () => {
  const spur = [nordlich(0, 0), nordlich(20, 1000)];

  it('benutzt `map_snap` und NICHT `edge_walk`', () => {
    // ─── DER UNTERSCHIED, DER HIER ENTSCHEIDET ──────────────────────────────
    // `edge_walk` setzt voraus, dass die Punkte EXAKT auf den Kanten liegen.
    // Das gilt für eine von Valhalla gelieferte Routengeometrie — für rohe
    // GPS-Punkte gilt es nie. Mit `edge_walk` käme hier gar nichts zurück.
    expect(buildSpurBody(spur, 'auto').shape_match).toBe('map_snap');
  });

  it('schickt die Punkte als {lat, lon} in Fahrtrichtung', () => {
    const body = buildSpurBody(spur, 'auto');
    expect(body.shape).toEqual([
      { lat: spur[0]?.lat, lon: spur[0]?.lon },
      { lat: spur[1]?.lat, lon: spur[1]?.lon },
    ]);
  });

  it('fragt genau die beiden Angaben ab, die gebraucht werden', () => {
    // Ohne Filter liefert Valhalla je Kante ein grosses Objekt.
    const filters = buildSpurBody(spur, 'auto').filters as { attributes: string[] };
    expect(filters.attributes).toEqual(['edge.speed_limit', 'edge.road_class']);
  });

  it('rechnet in km/h', () => {
    // `serialize_speed` skaliert nur bei `miles` -- eine falsche Einheit
    // ergäbe ein Schild mit einer plausibel aussehenden falschen Zahl.
    expect(buildSpurBody(spur, 'auto').units).toBe('kilometers');
  });

  it('reicht das Kostenmodell durch', () => {
    expect(buildSpurBody(spur, 'truck').costing).toBe('truck');
  });
});

describe('limitAusSpurAntwort — die LETZTE Kante zählt', () => {
  const lies = (roh: unknown) => limitAusSpurAntwort(roh, speedLimitOf, roadClassOf);

  it('nimmt die letzte Kante, nicht die erste', () => {
    // ─── WARUM DAS ENTSCHEIDET ──────────────────────────────────────────────
    // Die Spur ist die zurückgelegte Strecke; ihr jüngster Punkt ist die
    // aktuelle Position. Die erste Kante ist, wo man vorhin war — und dort
    // kann ein anderes Limit gegolten haben. Ein Schild, das die Straße von
    // vorhin zeigt, ist die unangenehmste Sorte Fehler: es stimmt beinahe.
    expect(
      lies({
        edges: [
          { speed_limit: 50, road_class: 'residential' },
          { speed_limit: 100, road_class: 'primary' },
        ],
      }),
    ).toEqual({ kmh: 100, road_class: 'primary' });
  });

  it('überspringt einen Stummel ohne jede Aussage am Ende', () => {
    expect(
      lies({
        edges: [
          { speed_limit: 100, road_class: 'primary' },
          { begin_shape_index: 5 },
        ],
      }),
    ).toEqual({ kmh: 100, road_class: 'primary' });
  });

  it('eine Autobahn ohne Schild liefert die Klasse trotzdem', () => {
    // Der wichtigste Fall überhaupt: kein Limit, aber `motorway` -- daraus
    // ergibt sich die Fahrzeuggrenze.
    expect(lies({ edges: [{ speed_limit: 'unlimited', road_class: 'motorway' }] })).toEqual({
      kmh: null,
      road_class: 'motorway',
    });
  });

  it('gibt `null` zurück, wenn gar nichts Brauchbares dabei ist', () => {
    for (const unsinn of [null, undefined, 42, 'nein', {}, { edges: [] }, { edges: 'nein' }]) {
      expect(lies(unsinn), JSON.stringify(unsinn)).toBeNull();
    }
    expect(lies({ edges: [{ begin_shape_index: 1 }] })).toBeNull();
  });

  it('wirft bei keiner Eingabe', () => {
    // Die Antwort kommt von einem fremden Dienst. Eine unerwartete Form darf
    // die Fahrt nicht stören.
    for (const unsinn of [null, [], { edges: [null, 3, 'x'] }]) {
      expect(() => lies(unsinn)).not.toThrow();
    }
  });
});

describe('abfrageFaellig — nicht im Sekundentakt', () => {
  it('die erste Abfrage ist sofort fällig', () => {
    expect(abfrageFaellig(null, 12_345)).toBe(true);
  });

  it('kurz danach nicht', () => {
    expect(abfrageFaellig(1_000, 1_000 + ABFRAGE_ABSTAND_MS - 1)).toBe(false);
  });

  it('nach dem Abstand wieder', () => {
    expect(abfrageFaellig(1_000, 1_000 + ABFRAGE_ABSTAND_MS)).toBe(true);
  });
});

describe('alsSpurpunkt', () => {
  it('macht aus einer Position einen Punkt mit Zeitstempel', () => {
    const p = alsSpurpunkt(pos({ ts: '2026-09-18T08:00:00.000Z' }));
    expect(p).toEqual({ lat: 49.239, lon: 8.32, ts: Date.parse('2026-09-18T08:00:00.000Z') });
  });

  it('eine untaugliche Position ergibt keinen Punkt', () => {
    expect(alsSpurpunkt(pos({ accuracy: 53.2 }))).toBeNull();
  });

  it('ein unlesbarer Zeitstempel macht den Punkt nicht unbrauchbar', () => {
    // Die POSITION ist ja gut. Sie wegen des Zeitstempels wegzuwerfen hiesse,
    // an der falschen Stelle streng zu sein.
    const p = alsSpurpunkt(pos({ ts: 'gestern' }));
    expect(p).not.toBeNull();
    expect(Number.isFinite(p?.ts)).toBe(true);
  });
});
