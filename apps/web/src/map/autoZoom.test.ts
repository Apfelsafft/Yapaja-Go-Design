/**
 * Automatischer Zoom -- die Regel.
 *
 * Gemeldet: „Füge bei der Navigation einen automatischen Zoom ein."
 *
 * Geprueft wird vor allem, wann er NICHT eingreift. Ein Zoom, der sich gegen
 * den Menschen stellt, ist schlimmer als gar keiner.
 */

import { describe, it, expect } from 'vitest';
import {
  autoZoomFor,
  shouldApplyZoom,
  MANEUVER_CLOSE_M,
  MANEUVER_ZOOM,
  MANEUVER_AT_M,
  MANEUVER_AT_ZOOM,
  SPEED_ZOOM_STEPS,
} from './autoZoom.js';

describe('woran sich die Stufe bemisst', () => {
  it('ein naher Abbiegepunkt gewinnt gegen die Geschwindigkeit', () => {
    // Kurz vor der Kreuzung nuetzt die Uebersicht nichts -- man muss die
    // Spur sehen. Auch bei Autobahntempo.
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: 200 })).toBe(MANEUVER_ZOOM);
  });

  it('genau an der Grenze zaehlt der Abbiegepunkt noch als nah', () => {
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: MANEUVER_CLOSE_M })).toBe(
      MANEUVER_ZOOM,
    );
    // Einen Meter weiter entscheidet wieder das Tempo.
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: MANEUVER_CLOSE_M + 1 })).toBe(14);
  });

  // ─── UNMITTELBAR VOR DEM ABBIEGEN NOCH EINE STUFE NAEHER ──────────────────
  // Gemeldet: „kurz vor der Abfahrt nach rechts bin ich noch recht weit
  // rausgezoomt." Stufe 17 griff dabei bereits (gemessen: 16,99 bei 222 m) --
  // sie ist nur zu weit weg.
  describe('unmittelbar vor dem Abbiegen', () => {
    it('gilt die engste Stufe', () => {
      expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: 100 })).toBe(MANEUVER_AT_ZOOM);
      expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: 0 })).toBe(MANEUVER_AT_ZOOM);
    });

    it('und sie ist wirklich naeher als die vorige', () => {
      // Sonst waere die ganze Stufe eine Verdopplung ohne Wirkung.
      expect(MANEUVER_AT_ZOOM).toBeGreaterThan(MANEUVER_ZOOM);
      expect(MANEUVER_AT_M).toBeLessThan(MANEUVER_CLOSE_M);
    });

    it('genau an ihrer Grenze noch, einen Meter weiter nicht mehr', () => {
      expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: MANEUVER_AT_M })).toBe(
        MANEUVER_AT_ZOOM,
      );
      expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: MANEUVER_AT_M + 1 })).toBe(
        MANEUVER_ZOOM,
      );
    });

    it('die Stufen folgen aufeinander, statt sich zu ueberspringen', () => {
      // Von weit nach nah darf die Zahl nur wachsen -- ein Zurueckspringen
      // waere ein Herauszoomen beim Naeherkommen.
      const stufen = [400, 250, 200, 150, 100, 20].map((m) =>
        autoZoomFor({ speedKmh: 50, distanceToManeuverM: m }),
      );
      for (let i = 1; i < stufen.length; i++) {
        expect(stufen[i]!, `bei Schritt ${i}`).toBeGreaterThanOrEqual(stufen[i - 1]!);
      }
    });
  });

  it('sonst entscheidet die Geschwindigkeit, und zwar naeher bei langsam', () => {
    const langsam = autoZoomFor({ speedKmh: 20, distanceToManeuverM: null });
    const schnell = autoZoomFor({ speedKmh: 130, distanceToManeuverM: null });
    expect(langsam).not.toBeNull();
    expect(schnell).not.toBeNull();
    // Groessere Zahl = naeher dran.
    expect(langsam!).toBeGreaterThan(schnell!);
  });

  it('jede Stufe liefert ihren Wert', () => {
    for (const step of SPEED_ZOOM_STEPS) {
      const probe = Number.isFinite(step.upToKmh) ? step.upToKmh : 200;
      expect(autoZoomFor({ speedKmh: probe, distanceToManeuverM: null })).toBe(step.zoom);
    }
  });

  it('Stillstand ist die naechste Stufe, nicht „keine Angabe"', () => {
    expect(autoZoomFor({ speedKmh: 0, distanceToManeuverM: null })).toBe(SPEED_ZOOM_STEPS[0].zoom);
  });
});

describe('wann NICHTS getan wird', () => {
  it('ohne Geschwindigkeit und ohne Abbiegepunkt', () => {
    // `null` heisst „nichts tun", nicht „Standardwert nehmen". Ein
    // Vorgabewert waere eine Kamerabewegung, die niemand angefordert hat.
    expect(autoZoomFor({ speedKmh: null, distanceToManeuverM: null })).toBeNull();
    expect(autoZoomFor({ speedKmh: undefined, distanceToManeuverM: undefined })).toBeNull();
  });

  it('bei unbrauchbaren Werten', () => {
    expect(autoZoomFor({ speedKmh: Number.NaN, distanceToManeuverM: null })).toBeNull();
    expect(autoZoomFor({ speedKmh: -5, distanceToManeuverM: null })).toBeNull();
  });

  it('eine unbrauchbare Entfernung faellt auf die Geschwindigkeit zurueck', () => {
    // Nicht auf `null`: das Tempo ist ja bekannt und eine gueltige Grundlage.
    //
    // Absichtlich mit 130 km/h geprueft und nicht mit 20: die langsamste
    // Stufe liefert zufaellig denselben Wert wie MANEUVER_ZOOM, ein Test mit
    // 20 km/h koennte also gar nicht fehlschlagen, wenn die Pruefung auf
    // negative Entfernungen wegfiele.
    const ohneAbbiegepunkt = autoZoomFor({ speedKmh: 130, distanceToManeuverM: null });
    expect(ohneAbbiegepunkt).not.toBe(MANEUVER_ZOOM);
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: Number.NaN })).toBe(ohneAbbiegepunkt);
    expect(autoZoomFor({ speedKmh: 130, distanceToManeuverM: -10 })).toBe(ohneAbbiegepunkt);
  });
});

describe('wann die Kamera wirklich bewegt wird', () => {
  it('nicht wegen einer winzigen Abweichung', () => {
    // Ohne diese Pruefung setzte JEDE Positionsmeldung die Kamera neu -- der
    // Unterschied zwischen „passt sich an" und „zappelt".
    expect(shouldApplyZoom(16.1, 16)).toBe(false);
    expect(shouldApplyZoom(16, 16)).toBe(false);
  });

  it('aber bei einem echten Stufenwechsel', () => {
    expect(shouldApplyZoom(14, 17)).toBe(true);
    expect(shouldApplyZoom(17, 14)).toBe(true);
  });

  it('und wenn der aktuelle Zoom unbekannt ist', () => {
    expect(shouldApplyZoom(null, 16)).toBe(true);
    expect(shouldApplyZoom(Number.NaN, 16)).toBe(true);
  });
});

/**
 * Die Stufe, die den Abbiegepunkt ins Bild holt (0.17.2).
 *
 * ─── WORAN SICH DIE ZAHLEN MESSEN ───────────────────────────────────────────
 * Alle Erwartungen hier sind AUSGESCHRIEBEN und nicht aus dem Prüfling
 * gerechnet. Ein Test, der seine Erwartung aus der Formel bezieht, bestätigt
 * nur, dass die Formel mit sich selbst übereinstimmt — und hätte den alten
 * Fehler („Stufe 17 bei 200 m, also Abbiegung am oberen Bildrand") genauso
 * bestätigt wie die Behebung.
 *
 * Die Anzeige ist durchgehend ein Tablet quer: 725 px hoch, 49,5 Grad Breite.
 * Das sind dieselben Zahlen, mit denen die Tabelle in `drivePadding.ts`
 * gerechnet wurde, also lassen sich die Ergebnisse dort nachschlagen.
 */
describe('der Zoom holt den Abbiegepunkt ins Bild', () => {
  const HOEHE = 725;
  const BREITE = 49.5;

  /** Wie viele Meter auf dieser Stufe voraus sichtbar sind. */
  function sichtbarVoraus(zoom: number): number {
    return HOEHE * 0.75 * (40_075_016.686 / 512) * Math.cos((BREITE * Math.PI) / 180) / 2 ** zoom;
  }

  it('bei 200 m steht die Abbiegung nicht mehr am oberen Rand', () => {
    // Der gemeldete Fall. Alt war 17 -- und auf 17 liegt die Abbiegung bei
    // 95 % der sichtbaren Strecke, also praktisch auf der Kante.
    const zoom = autoZoomFor({
      speedKmh: 50,
      distanceToManeuverM: 200,
      mapHeightPx: HOEHE,
      lat: BREITE,
    });
    expect(zoom).toBe(16.5);

    // Und die Probe aufs Exempel: sie liegt jetzt im mittleren Drittel.
    const anteil = 200 / sichtbarVoraus(zoom as number);
    expect(anteil).toBeLessThan(0.8);
    expect(anteil, 'nicht so weit weg, dass sie winzig wird').toBeGreaterThan(0.4);
  });

  it('auf der Autobahn erscheint die Abfahrt früher als bisher', () => {
    // ─── DER EIGENTLICHE FALL AUS DER PROBEFAHRT ───────────────────────────
    // 120 km/h, Abfahrt in 800 m. Alt: Stufe 14 (reines Tempo) bis 250 m --
    // bei 120 km/h sind das siebeneinhalb Sekunden vor dem Abbiegen.
    const zoom = autoZoomFor({
      speedKmh: 120,
      distanceToManeuverM: 800,
      mapHeightPx: HOEHE,
      lat: BREITE,
    });
    expect(zoom).toBe(14.5);
    expect(800 / sichtbarVoraus(zoom as number)).toBeLessThan(0.8);
  });

  it('bei 10 km wird NICHT hinausgezoomt -- das Tempo gilt', () => {
    // Wörtlich gewünscht: „nicht wenn man noch 10km vor sich hat".
    const zoom = autoZoomFor({
      speedKmh: 120,
      distanceToManeuverM: 10_000,
      mapHeightPx: HOEHE,
      lat: BREITE,
    });
    expect(zoom, 'die Tempo-Stufe für über 100 km/h').toBe(14);
  });

  it('die Rechnung kann nur heranholen, nie heraus', () => {
    // Die Gegenprobe zum Test darüber, über den ganzen Bereich: bei jeder
    // Entfernung muss die Stufe mindestens die des Tempos sein.
    for (const d of [300, 1_000, 3_000, 10_000, 50_000]) {
      const zoom = autoZoomFor({
        speedKmh: 130,
        distanceToManeuverM: d,
        mapHeightPx: HOEHE,
        lat: BREITE,
      });
      expect(zoom, `bei ${d} m`).toBeGreaterThanOrEqual(14);
    }
  });

  it('holt nicht näher als Stufe 18, auch direkt vor der Abbiegung', () => {
    // Bei 20 m ergäbe die Rechnung über 20 -- eine Karte, auf der eine
    // einzelne Kreuzung den Schirm füllt und nichts mehr einzuordnen ist.
    expect(
      autoZoomFor({ speedKmh: 20, distanceToManeuverM: 20, mapHeightPx: HOEHE, lat: BREITE }),
    ).toBe(18);
  });

  it('läuft in halben Stufen, damit die Karte nicht zittert', () => {
    // Eine stetige Zahl verstellte die Kamera bei jeder Positionsmeldung um
    // ein Haar. Über einen ganzen Anfahrtsweg dürfen nur halbe Stufen
    // vorkommen.
    for (let d = 1_000; d >= 50; d -= 10) {
      const zoom = autoZoomFor({
        speedKmh: 60,
        distanceToManeuverM: d,
        mapHeightPx: HOEHE,
        lat: BREITE,
      }) as number;
      expect(zoom * 2, `bei ${d} m kam ${zoom} heraus`).toBe(Math.round(zoom * 2));
    }
  });

  it('die Stufe wächst monoton, je näher die Abbiegung kommt', () => {
    // Sie darf beim Heranfahren nie wieder gröber werden -- das wäre ein
    // Hinauszoomen mitten in der Anfahrt.
    let vorher = 0;
    for (let d = 2_000; d >= 30; d -= 10) {
      const zoom = autoZoomFor({
        speedKmh: 60,
        distanceToManeuverM: d,
        mapHeightPx: HOEHE,
        lat: BREITE,
      }) as number;
      expect(zoom, `bei ${d} m`).toBeGreaterThanOrEqual(vorher);
      vorher = zoom;
    }
  });

  it('ohne Bildhöhe oder Breite gelten die alten Schwellen', () => {
    // Kein Notbehelf, sondern der richtige Rückfall: eine geratene Bildhöhe
    // verstellte die Kamera aufgrund einer Zahl, die niemand gemessen hat.
    expect(autoZoomFor({ speedKmh: 50, distanceToManeuverM: 200 })).toBe(MANEUVER_ZOOM);
    expect(autoZoomFor({ speedKmh: 50, distanceToManeuverM: 100 })).toBe(MANEUVER_AT_ZOOM);
    expect(
      autoZoomFor({ speedKmh: 50, distanceToManeuverM: 200, mapHeightPx: 725, lat: null }),
    ).toBe(MANEUVER_ZOOM);
  });

  it('eine kleinere Anzeige bekommt eine gröbere Stufe', () => {
    // Der Grund, warum Bildhöhe überhaupt hereinkommt: auf einem Telefon
    // hochkant ist weniger Strecke im Bild, also muss weiter herausgezoomt
    // werden, damit dieselbe Abbiegung hineinpasst.
    // ─── 150 m UND NICHT 300 ──────────────────────────────────────────────
    // Bei 300 m liegt die gerechnete Stufe für BEIDE Anzeigen unter der
    // Tempo-Untergrenze (50 km/h -> 16), und die überdeckt den Unterschied:
    // der erste Anlauf dieses Tests verglich 16 mit 16 und wäre bei jeder
    // beliebigen Formel grün gewesen.
    const tablet = autoZoomFor({
      speedKmh: 50,
      distanceToManeuverM: 150,
      mapHeightPx: 725,
      lat: BREITE,
    }) as number;
    const telefon = autoZoomFor({
      speedKmh: 50,
      distanceToManeuverM: 150,
      mapHeightPx: 360,
      lat: BREITE,
    }) as number;
    expect(tablet).toBe(17);
    expect(telefon).toBe(16);
  });

  it('weiter im Norden wird gröber gezoomt', () => {
    // In Web-Mercator schrumpft der Maßstab mit dem Kosinus der Breite: auf
    // 70 Grad bedeutet dieselbe Zoomstufe weniger Meter je Bildpunkt, also
    // passt weniger Strecke ins Bild.
    // Auch hier 150 m, aus demselben Grund wie oben.
    const pfalz = autoZoomFor({
      speedKmh: 50,
      distanceToManeuverM: 150,
      mapHeightPx: 725,
      lat: 49.5,
    }) as number;
    const nordkap = autoZoomFor({
      speedKmh: 50,
      distanceToManeuverM: 150,
      mapHeightPx: 725,
      lat: 71,
    }) as number;
    expect(pfalz).toBe(17);
    expect(nordkap).toBe(16);
  });
});
