import { describe, expect, it } from 'vitest';
import { ANKER_ID, ankerFuer, ankerRaender, begrenzeAnker, standardAnker } from './kartenAnker.js';
import { driveRaender } from './drivePadding.js';

describe('kartenAnker', () => {
  it('Standard: Ruhe in der Mitte, Fahrt im unteren Viertel der Fahrerseite', () => {
    expect(standardAnker('ruhe', 'lhd')).toEqual({ x: 0.5, y: 0.5 });
    expect(standardAnker('fahrt', 'lhd')).toEqual({ x: 0.25, y: 0.75 });
    expect(standardAnker('fahrt', 'rhd')).toEqual({ x: 0.75, y: 0.75 });
  });

  it('der eingestellte Anker gewinnt, begrenzt auf 10–90 %', () => {
    expect(ankerFuer({ [ANKER_ID]: { dx: 0.3, dy: 0.6, s: 1 } }, 'ruhe', 'lhd')).toEqual({ x: 0.3, y: 0.6 });
    expect(ankerFuer({}, 'fahrt', 'rhd')).toEqual({ x: 0.75, y: 0.75 });
    expect(begrenzeAnker({ x: -1, y: 2 })).toEqual({ x: 0.1, y: 0.9 });
  });

  it('Ränder schieben die Mitte auf den Anker -- in alle vier Richtungen', () => {
    expect(ankerRaender(1000, 800, { x: 0.5, y: 0.5 })).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(ankerRaender(1000, 800, { x: 0.25, y: 0.75 })).toEqual({ top: 400, bottom: 0, left: 0, right: 500 });
    expect(ankerRaender(1000, 800, { x: 0.7, y: 0.3 })).toEqual({ top: 0, bottom: 320, left: 400, right: 0 });
    expect(ankerRaender(null, 800, { x: 0.5, y: 0.5 })).toBeNull();
  });

  it('der Fahrt-Standard ergibt dieselben Ränder wie bisher', () => {
    const alt = driveRaender(1000, 800, 'lhd')!;
    const neu = ankerRaender(1000, 800, standardAnker('fahrt', 'lhd'))!;
    expect({ top: neu.top, left: neu.left, right: neu.right }).toEqual(alt);
    expect(neu.bottom).toBe(0);
  });

  it('die Mitte des Restbereichs liegt auf dem Anker', () => {
    const r = ankerRaender(1200, 900, { x: 0.35, y: 0.62 })!;
    expect((r.left + (1200 - r.right)) / 2 / 1200).toBeCloseTo(0.35, 2);
    expect((r.top + (900 - r.bottom)) / 2 / 900).toBeCloseTo(0.62, 2);
  });
});
