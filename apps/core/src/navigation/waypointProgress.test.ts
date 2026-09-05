/**
 * Welche Zwischenziele bei einer Neuberechnung noch anzufahren sind.
 *
 * ─── DER FEHLER, DEN DAS ABSICHERT ──────────────────────────────────────────
 * Im Core stand seit E04-T5 „passed through as-is; E04-T5 prunes visited
 * ones". Es gab keine solche Bereinigung. Wer an einem Zwischenziel vorbei
 * war und dann falsch abbog, wurde zurueckgeschickt.
 *
 * Geprueft wird deshalb beides: dass Passiertes wegfaellt UND dass im
 * Zweifel nichts verschwindet.
 */

import { describe, it, expect } from 'vitest';
import type { LatLng } from '@yapaja/shared';
import { buildRouteGeometryFromPoints } from './mapMatching.js';
import {
  anchorWaypoints,
  remainingWaypoints,
  WAYPOINT_ON_ROUTE_RADIUS_M,
  WAYPOINT_PASSED_MARGIN_M,
} from './waypointProgress.js';

const BASE_LAT = 47.2;
const BASE_LON = 9.6;
const M_PER_DEG_LAT = 111_195;

/** Punkt `m` Meter noerdlich vom Streckenanfang. */
function nordlich(m: number): LatLng {
  return { lat: BASE_LAT + m / M_PER_DEG_LAT, lon: BASE_LON };
}

/** Punkt `m` Meter noerdlich, dazu `abstand` Meter nach Osten versetzt. */
function daneben(m: number, abstand: number): LatLng {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((BASE_LAT * Math.PI) / 180);
  return { lat: BASE_LAT + m / M_PER_DEG_LAT, lon: BASE_LON + abstand / mPerDegLon };
}

/** Gerade Strecke von 0 bis 2000 m nach Norden. */
const GEOM = buildRouteGeometryFromPoints(
  Array.from({ length: 21 }, (_, i) => {
    const p = nordlich(i * 100);
    return { lat: p.lat, lon: p.lon };
  }),
);

describe('was schon hinter einem liegt, faellt weg', () => {
  it('das passierte Zwischenziel verschwindet, das kommende bleibt', () => {
    // Genau der gemeldete Ablauf: Zwischenziel bei 500 m ist abgehakt, das
    // bei 1500 m noch nicht. Ohne diese Bereinigung schickte die
    // Neuberechnung zurueck zu 500 m.
    const uebrig = remainingWaypoints([nordlich(500), nordlich(1500)], GEOM, 1000);
    expect(uebrig).toHaveLength(1);
    expect(uebrig[0].lat).toBeCloseTo(nordlich(1500).lat, 9);
  });

  it('alle passiert = leere Liste', () => {
    expect(remainingWaypoints([nordlich(200), nordlich(400)], GEOM, 1200)).toEqual([]);
  });

  it('noch keines passiert = alle bleiben', () => {
    const wp = [nordlich(500), nordlich(1500)];
    expect(remainingWaypoints(wp, GEOM, 100)).toHaveLength(2);
  });

  it('die Reihenfolge bleibt erhalten', () => {
    // Der Betreiber hat sie bewusst sortiert („in der Reihenfolge sortieren
    // koennen"). Eine Neuberechnung darf daran nichts drehen.
    const uebrig = remainingWaypoints([nordlich(800), nordlich(1200), nordlich(1600)], GEOM, 100);
    expect(uebrig.map((w) => Math.round((w.lat - BASE_LAT) * M_PER_DEG_LAT))).toEqual([800, 1200, 1600]);
  });
});

describe('der Rand um „gerade eben passiert"', () => {
  it('direkt auf Hoehe des Zwischenziels gilt es noch als offen', () => {
    // Ohne diesen Rand spraenge es bei schwankender Position zwischen
    // „passiert" und „noch nicht" -- und jede Neuberechnung ergaebe eine
    // andere Route.
    expect(remainingWaypoints([nordlich(1000)], GEOM, 1000)).toHaveLength(1);
  });

  it('erst deutlich dahinter faellt es weg', () => {
    const knappDavor = remainingWaypoints([nordlich(1000)], GEOM, 1000 + WAYPOINT_PASSED_MARGIN_M - 5);
    const deutlichDahinter = remainingWaypoints(
      [nordlich(1000)],
      GEOM,
      1000 + WAYPOINT_PASSED_MARGIN_M + 5,
    );
    expect(knappDavor).toHaveLength(1);
    expect(deutlichDahinter).toHaveLength(0);
  });
});

describe('im Zweifel wird behalten', () => {
  it('ohne bekannten Fortschritt bleibt alles stehen', () => {
    // Nichts ist nachweislich passiert, also wird nichts verworfen.
    const wp = [nordlich(200), nordlich(1800)];
    expect(remainingWaypoints(wp, GEOM, null)).toHaveLength(2);
    expect(remainingWaypoints(wp, GEOM, Number.NaN)).toHaveLength(2);
  });

  it('ein Zwischenziel weit neben der Strecke bleibt, auch wenn es „hinter" einem laege', () => {
    // Die Projektion eines weit entfernten Ortes trifft irgendeine Stelle
    // der Strecke -- die hat mit dem gewuenschten Ort nichts zu tun. Ein
    // faelschlich verworfenes Zwischenziel verschwindet stillschweigend;
    // ein behaltenes sieht man und kann es wegnehmen.
    const weitWeg = daneben(300, WAYPOINT_ON_ROUTE_RADIUS_M + 200);
    expect(remainingWaypoints([weitWeg], GEOM, 1500)).toHaveLength(1);
  });

  it('ein Zwischenziel knapp neben der Strecke wird dagegen beurteilt', () => {
    // Der Normalfall: ein Parkplatz oder eine Hausnummer liegt ein paar
    // Meter neben der Durchgangsstrasse. Das ist dasselbe Ziel.
    const knappDaneben = daneben(300, 30);
    expect(remainingWaypoints([knappDaneben], GEOM, 1500)).toHaveLength(0);
  });

  it('eine leere Liste bleibt leer', () => {
    expect(remainingWaypoints([], GEOM, 500)).toEqual([]);
  });
});

describe('die Projektion selbst', () => {
  it('findet die Stelle auf der Strecke', () => {
    const [anchor] = anchorWaypoints([nordlich(700)], GEOM);
    expect(anchor.progressM).not.toBeNull();
    expect(anchor.progressM!).toBeCloseTo(700, 0);
    expect(anchor.crossTrackM).toBeLessThan(1);
  });

  it('meldet „nicht beurteilbar" statt einer erfundenen Stelle', () => {
    const [anchor] = anchorWaypoints([daneben(300, WAYPOINT_ON_ROUTE_RADIUS_M + 200)], GEOM);
    expect(anchor.progressM).toBeNull();
    expect(anchor.crossTrackM).toBeGreaterThan(WAYPOINT_ON_ROUTE_RADIUS_M);
  });

  it('behaelt die Ursprungsposition in der Liste', () => {
    const anchors = anchorWaypoints([nordlich(900), nordlich(300)], GEOM);
    expect(anchors.map((a) => a.index)).toEqual([0, 1]);
  });
});
