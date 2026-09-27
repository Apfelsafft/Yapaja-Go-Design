/**
 * Kreisel: Ausfahrtsnummer und Drehwinkel aus Valhallas Manoevern.
 *
 * Die Feldnamen (`roundabout_exit_count`, `bearing_before`, `bearing_after`)
 * und die Typnummern (26 Einfahrt, 27 Ausfahrt) stammen aus Valhallas
 * API-Referenz (`docs/api/route/api-reference.md`).
 */

import { describe, it, expect } from 'vitest';
import { validateRoute } from '@yapaia/shared';
import { drehung, kreiselAngaben } from './kreisel.js';
import { mapValhallaResponse } from './mapResponse.js';
import { encodePolyline6 } from './polyline.js';
import type { ValhallaManeuver } from './types.js';

const m = (type: number, extra: Partial<ValhallaManeuver> = {}): ValhallaManeuver => ({
  type,
  length: 0.1,
  begin_shape_index: 0,
  ...extra,
});

describe('drehung', () => {
  it('rechnet im Uhrzeigersinn positiv', () => {
    expect(drehung(0, 90)).toBe(90);
    expect(drehung(0, 270)).toBe(-90);
    expect(drehung(90, 90)).toBe(0);
  });

  it('nimmt den kurzen Weg ueber Nord', () => {
    // 350° → 10° ist eine Rechtsdrehung um 20°, nicht links um 340°.
    expect(drehung(350, 10)).toBe(20);
    expect(drehung(10, 350)).toBe(-20);
  });

  it('meldet Umkehren als +180 und nie als -180', () => {
    // Eine Richtung, zwei Schreibweisen -- das Display soll nur eine sehen.
    expect(drehung(0, 180)).toBe(180);
    expect(drehung(180, 0)).toBe(180);
    expect(drehung(90, 270)).toBe(180);
  });
});

describe('kreiselAngaben', () => {
  it('gibt Einfahrt und Ausfahrt dieselbe Nummer und denselben Winkel', () => {
    const raus = kreiselAngaben([
      m(1),
      m(26, { roundabout_exit_count: 2, bearing_before: 0, bearing_after: 60 }),
      m(27, { bearing_before: 30, bearing_after: 90 }),
      m(4),
    ]);
    const erwartet = { roundabout_exit_count: 2, roundabout_turn_deg: 90 };
    expect(raus).toEqual([{}, erwartet, erwartet, {}]);
  });

  it('nimmt fuer den Winkel die Richtung VOR der Einfahrt und NACH der Ausfahrt', () => {
    // Die jeweils anderen beiden Werte zeigen in den Kreisel hinein bzw.
    // liegen auf ihm -- mit ihnen kaeme eine Drehung heraus, die niemand
    // faehrt. Deshalb sind sie hier absichtlich irrefuehrend gesetzt.
    const [ein] = kreiselAngaben([
      m(26, { roundabout_exit_count: 3, bearing_before: 180, bearing_after: 999 }),
      m(27, { bearing_before: 999, bearing_after: 90 }),
    ]);
    expect(ein!.roundabout_turn_deg).toBe(-90);
  });

  it('behaelt die Nummer, wenn die Ausfahrt fehlt', () => {
    // Etwa, wenn das Ziel im Kreisel liegt.
    expect(kreiselAngaben([m(26, { roundabout_exit_count: 1, bearing_before: 0 }), m(4)])).toEqual([
      { roundabout_exit_count: 1 },
      {},
    ]);
  });

  it('ordnet die Ausfahrt des ZWEITEN Kreisels nicht dem ersten zu', () => {
    const raus = kreiselAngaben([
      m(26, { roundabout_exit_count: 1, bearing_before: 0 }),
      m(26, { roundabout_exit_count: 2, bearing_before: 90 }),
      m(27, { bearing_after: 180 }),
    ]);
    expect(raus[0]).toEqual({ roundabout_exit_count: 1 });
    expect(raus[1]).toEqual({ roundabout_exit_count: 2, roundabout_turn_deg: 90 });
    expect(raus[2]).toEqual(raus[1]);
  });

  it('laesst unbrauchbare Werte weg statt sie weiterzugeben', () => {
    const raus = kreiselAngaben([
      m(26, { roundabout_exit_count: 0, bearing_before: Number.NaN }),
      m(27, { bearing_after: 90 }),
    ]);
    expect(raus).toEqual([{}, {}]);
  });

  it('beruehrt andere Manoever nicht', () => {
    expect(kreiselAngaben([m(10, { bearing_before: 0, bearing_after: 90 })])).toEqual([{}]);
  });
});

describe('Kreisel in der Route', () => {
  it('kommt schema-gueltig bis in die Manoever', () => {
    const [route] = mapValhallaResponse(
      {
        trip: {
          summary: { length: 1, time: 60 },
          legs: [
            {
              shape: encodePolyline6([
                { lat: 0, lon: 0 },
                { lat: 0, lon: 0.005 },
                { lat: 0, lon: 0.009 },
              ]),
              summary: { length: 1, time: 60 },
              maneuvers: [
                m(1, { length: 0.5 }),
                m(26, { roundabout_exit_count: 2, bearing_before: 90, begin_shape_index: 1 }),
                m(27, { bearing_after: 90, begin_shape_index: 1 }),
                m(4, { length: 0, begin_shape_index: 2 }),
              ],
            },
          ],
        },
      },
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.009 },
    );
    expect(validateRoute(route)).toBe(true);
    expect(route!.maneuvers[1]).toMatchObject({
      type: 'roundabout_enter',
      roundabout_exit_count: 2,
      roundabout_turn_deg: 0,
    });
    // Nicht am Kreisel: die Felder fehlen ganz, statt `undefined` zu sein.
    expect('roundabout_exit_count' in route!.maneuvers[0]!).toBe(false);
  });
});
