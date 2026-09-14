/**
 * Das Urteil über eine Antwort — ohne Netz prüfbar.
 *
 * Der Lauf selbst befragt Geofabrik und gehört deshalb in den wöchentlichen
 * Nightly. Die REGEL, wann eine Adresse als vorhanden gilt, darf davon nicht
 * abhängen: sie entscheidet, ob ein roter Job ein echter Fund ist oder ein
 * Fehlalarm über unsere eigene Anfragemethode.
 */
import { describe, it, expect } from 'vitest';
import { urteil } from './check-region-catalog.mjs';

describe('check-region-catalog: wann gilt eine Adresse als vorhanden', () => {
  it('nimmt 200 und Umleitungen an', () => {
    for (const status of [200, 301, 302, 307, 308]) {
      expect(urteil(status).ok, String(status)).toBe(true);
    }
  });

  it('meldet 404 als Fund, nicht als Panne', () => {
    const ergebnis = urteil(404);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.hinweis).toContain('gibt es nicht');
  });

  it('wertet „HEAD nicht erlaubt" NICHT als fehlende Datei', () => {
    // Manche Server lehnen HEAD ab, ohne dass die Datei fehlt. Das als Fehler
    // zu werten, wäre ein roter Job über unsere eigene Anfragemethode -- und
    // genau solche Fehlalarme stumpfen die Aufmerksamkeit für echte Funde ab.
    for (const status of [405, 501]) {
      expect(urteil(status).ok, String(status)).toBe(true);
    }
  });

  it('lässt keinen unbekannten Fehlerstatus stillschweigend durchgehen', () => {
    for (const status of [403, 500, 503]) {
      expect(urteil(status).ok, String(status)).toBe(false);
      expect(urteil(status).hinweis).toContain(String(status));
    }
  });
});
