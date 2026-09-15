/**
 * Der Optionswert für „Position aus der Companion App".
 *
 * Bis 0.8.7 galt hier zusätzlich der alte Wert `ha_tracker`, damit ein Update
 * keine bestehende Installation still ohne Positionsquelle lässt. Seit 0.8.8
 * ist er weg — es gibt keine fremden Installationen, auf die Rücksicht zu
 * nehmen wäre, und der doppelte Wert stand als zweiter, gleichbedeutender
 * Knopf sichtbar in der Konfigurationsseite.
 */
import { describe, it, expect } from 'vitest';
import { COMPANION_APP_OPTION, istCompanionAppQuelle } from './gpsSourceOption.js';

describe('gps_source: die Companion App', () => {
  it('erkennt den Wert', () => {
    expect(istCompanionAppQuelle(COMPANION_APP_OPTION)).toBe(true);
    expect(COMPANION_APP_OPTION).toBe('companion_app');
  });

  it('erkennt den alten Wert NICHT mehr', () => {
    // Der Supervisor lässt ihn seit 0.8.8 gar nicht mehr durch das Schema.
    // Hier trotzdem festgehalten: käme er auf einem anderen Weg herein, soll
    // er nicht stillschweigend etwas anderes bedeuten.
    expect(istCompanionAppQuelle('ha_tracker')).toBe(false);
  });

  it('sagt bei jeder anderen Quelle nein', () => {
    for (const wert of ['usb', 'network', 'none', '', undefined, null]) {
      expect(istCompanionAppQuelle(wert), String(wert)).toBe(false);
    }
  });

  /**
   * ─── DIE ZWEITE BEDEUTUNG VON „ha_tracker" BLEIBT ─────────────────────────
   * `Position.source` heisst weiterhin `'ha_tracker'`. Das ist kein
   * Optionswert, sondern Übertragungsformat: es steht in `nav/state`, in den
   * MQTT-Nutzlasten und in den Home-Assistant-Entitäten.
   *
   * Hier festgehalten, weil beim Aufräumen des Optionswerts die Versuchung
   * gross ist, „alle ha_tracker" zu entfernen — und das wäre eine stille
   * Änderung am Übertragungsformat.
   */
  it('lässt das Übertragungsformat unangetastet', async () => {
    const { positionSchema } = await import('@yapaia/shared');
    // Ohne Umdeutung: das Schema ist `as const`, die Werte sind also ein
    // festes Tupel. Genau deshalb faellt eine Umbenennung hier ueberhaupt auf.
    const quellen: readonly string[] = positionSchema.properties.source.enum;
    expect(quellen, 'Position.source-Werte im API-Schema').toContain('ha_tracker');
  });
});
