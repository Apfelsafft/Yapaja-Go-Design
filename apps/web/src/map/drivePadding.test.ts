/**
 * Die Lage des Fahrzeugs im Bild waehrend der Fahrt.
 *
 * Die Rechnung dahinter steht in `drivePadding.ts`; hier wird sie festgehalten
 * und gegen die Faelle geprueft, in denen sie schaden koennte.
 */

import { describe, it, expect } from 'vitest';
import { DRIVE_VEHICLE_Y, drivePaddingTop } from './drivePadding.js';

describe('das Fahrzeug sitzt unten, nicht in der Mitte', () => {
  it('das ist der ganze Punkt', () => {
    expect(DRIVE_VEHICLE_Y).toBeGreaterThan(0.5);
  });

  it('der Rand oben schiebt es genau dorthin', () => {
    // Gegenrechnung, nicht Wiederholung der Formel: aus dem Rand ergibt sich
    // die Lage des Mittelpunkts, und die muss DRIVE_VEHICLE_Y treffen.
    for (const hoehe of [400, 725, 1000, 1440]) {
      const rand = drivePaddingTop(hoehe)!;
      const mittelpunktY = rand + (hoehe - rand) / 2;
      expect(mittelpunktY / hoehe, `bei ${hoehe} px`).toBeCloseTo(DRIVE_VEHICLE_Y, 2);
    }
  });

  it('und damit ist mehr Strecke voraus zu sehen als vorher', () => {
    const hoehe = 725;
    const rand = drivePaddingTop(hoehe)!;
    const vorausVorher = hoehe / 2; // mittig
    const vorausJetzt = rand + (hoehe - rand) / 2;
    expect(vorausJetzt).toBeGreaterThan(vorausVorher);
  });
});

describe('wo nichts verschoben wird', () => {
  it('ohne bekannte Hoehe', () => {
    // Sonst laege das Fahrzeug nach einer geratenen Zahl irgendwo.
    expect(drivePaddingTop(null)).toBeNull();
    expect(drivePaddingTop(undefined)).toBeNull();
    expect(drivePaddingTop(Number.NaN)).toBeNull();
  });

  it('bei einer Hoehe, die keine ist', () => {
    expect(drivePaddingTop(0)).toBeNull();
    expect(drivePaddingTop(-100)).toBeNull();
  });
});

describe('unten bleibt Bild uebrig', () => {
  it('auf jeder Anzeigenhoehe', () => {
    // Klebte das Fahrzeug am unteren Rand, wuerde das Mitdrehen der Karte
    // unruhig. Eine eigene Deckelung dafuer stand hier zuerst -- sie griff
    // ausnahmslos und verstellte damit nur die Konstante, statt einen Fall
    // abzufangen (siehe `drivePadding.ts`). Geprueft wird deshalb die
    // Eigenschaft selbst.
    for (const hoehe of [200, 300, 400, 725, 1440]) {
      const rand = drivePaddingTop(hoehe)!;
      const mittelpunktY = rand + (hoehe - rand) / 2;
      expect(hoehe - mittelpunktY, `Platz unter dem Fahrzeug bei ${hoehe} px`).toBeGreaterThan(
        hoehe * 0.2,
      );
    }
  });
});
