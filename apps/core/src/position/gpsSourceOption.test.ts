/**
 * Der alte Optionswert muss weiter gelten — sonst schaltet ein Update die
 * Positionsquelle still ab.
 */
import { describe, it, expect } from 'vitest';
import {
  COMPANION_APP_OPTION,
  COMPANION_APP_OPTION_ALT,
  istCompanionAppQuelle,
} from './gpsSourceOption.js';

describe('gps_source: die Companion App', () => {
  it('erkennt den neuen Wert', () => {
    expect(istCompanionAppQuelle(COMPANION_APP_OPTION)).toBe(true);
  });

  it('erkennt den alten Wert weiterhin', () => {
    // Bestehende Installationen tragen ihn in der Konfiguration. Ein Update,
    // das ihre Positionsquelle abschaltet, wäre ein schwerer Fehler -- und
    // zwar einer, der erst im Fahrzeug auffällt.
    expect(istCompanionAppQuelle(COMPANION_APP_OPTION_ALT)).toBe(true);
    expect(COMPANION_APP_OPTION_ALT).toBe('ha_tracker');
  });

  it('sagt bei jeder anderen Quelle nein', () => {
    for (const wert of ['usb', 'network', 'none', '', undefined, null]) {
      expect(istCompanionAppQuelle(wert), String(wert)).toBe(false);
    }
  });
});
