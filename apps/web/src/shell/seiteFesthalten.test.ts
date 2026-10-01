import { describe, it, expect } from 'vitest';
import { seiteFesthalten } from './seiteFesthalten.js';

function fensterAttrappe() {
  const hoerer: Array<() => void> = [];
  const f = {
    scrollX: 0,
    scrollY: 0,
    document: { getElementById: () => null },
    addEventListener: (_: string, h: () => void) => hoerer.push(h),
    removeEventListener: (_: string, h: () => void) => hoerer.splice(hoerer.indexOf(h), 1),
    scrollTo(x: number, y: number) {
      f.scrollX = x;
      f.scrollY = y;
    },
  };
  return { f, feuern: () => hoerer.forEach((h) => h()), hoerer };
}

describe('seiteFesthalten', () => {
  it('schiebt eine verschobene Seite zurück an den Anfang', () => {
    const { f, feuern } = fensterAttrappe();
    seiteFesthalten(f as unknown as Window);
    f.scrollY = 118; // der gemeldete Versatz
    feuern();
    expect(f.scrollY).toBe(0);
  });

  it('lässt sich wieder lösen', () => {
    const { f, hoerer } = fensterAttrappe();
    const loesen = seiteFesthalten(f as unknown as Window);
    expect(hoerer).toHaveLength(1);
    loesen();
    expect(hoerer).toHaveLength(0);
  });
});
