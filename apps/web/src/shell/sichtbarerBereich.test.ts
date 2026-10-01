import { describe, it, expect } from 'vitest';
import { berechneRaender, KEINE_RAENDER } from './sichtbarerBereich.js';

/** Ein Fenster ohne Eltern, so groß wie angegeben. */
function oben(breite: number, hoehe: number): Window {
  const w = { innerWidth: breite, innerHeight: hoehe, visualViewport: null } as unknown as Window & { parent: Window };
  (w as { parent: Window }).parent = w;
  return w;
}

/** Ein Rahmen in `eltern`, dessen Oberkante bei (x, y) im Elternfenster liegt. */
function rahmen(eltern: Window, x: number, y: number, breite: number, hoehe: number): Window {
  return {
    innerWidth: breite,
    innerHeight: hoehe,
    visualViewport: null,
    parent: eltern,
    frameElement: {
      clientLeft: 0,
      clientTop: 0,
      getBoundingClientRect: () => ({ left: x, top: y, right: x + breite, bottom: y + hoehe }),
    },
  } as unknown as Window;
}

describe('berechneRaender', () => {
  it('ohne Rahmen und ohne Tastatur ist nichts verdeckt', () => {
    expect(berechneRaender(oben(1024, 768))).toEqual(KEINE_RAENDER);
  });

  it('der gemeldete Fall: Rahmen höher als der Bildschirm, Seite ein Stück gescrollt', () => {
    // Home Assistant: 1024 x 768 sichtbar. Der Rahmen beginnt 40 px über dem
    // oberen Bildschirmrand und ist 900 hoch -- unten stehen 92 px über.
    const ha = oben(1024, 768);
    const yapaia = rahmen(ha, 0, -40, 1024, 900);
    expect(berechneRaender(yapaia)).toEqual({ oben: 40, unten: 92, links: 0, rechts: 0 });
  });

  it('ein Rahmen neben der Seitenleiste, der rechts übersteht', () => {
    const ha = oben(1024, 768);
    const yapaia = rahmen(ha, 256, 56, 800, 712);
    expect(berechneRaender(yapaia)).toEqual({ oben: 0, unten: 0, links: 0, rechts: 32 });
  });

  it('die Bildschirmtastatur (visualViewport) zählt als verdeckt', () => {
    const w = oben(1024, 768);
    (w as unknown as { visualViewport: unknown }).visualViewport = {
      offsetTop: 0,
      offsetLeft: 0,
      width: 1024,
      height: 450,
    };
    expect(berechneRaender(w).unten).toBe(318);
  });

  it('ist der Rahmen fast ganz aus dem Bild, wird NICHT auf eine Briefmarke verkleinert', () => {
    const ha = oben(1024, 768);
    const yapaia = rahmen(ha, 0, 650, 1024, 900);
    expect(berechneRaender(yapaia)).toEqual(KEINE_RAENDER);
  });

  it('unter fremder Adresse (kein Blick nach oben) bleibt alles, wie es war', () => {
    const ha = oben(1024, 768);
    const fremd = {
      innerWidth: 1024,
      innerHeight: 900,
      visualViewport: null,
      parent: ha,
      get frameElement(): never {
        throw new DOMException('Blocked', 'SecurityError');
      },
    } as unknown as Window;
    expect(berechneRaender(fremd)).toEqual(KEINE_RAENDER);
  });
});
