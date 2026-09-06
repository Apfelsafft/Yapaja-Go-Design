/**
 * Die Fehlergrenze -- und vor allem, dass sie ueberhaupt eingehaengt ist.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Nach kurzer Zeit verschwindet die gesamte Anzeige und man sieht nur noch
 * einen blanken Screen. Nur die HA Menüs sind noch da."
 *
 * React 18 raeumt bei einem durchschlagenden Fehler den GANZEN Baum ab. Diese
 * Anwendung hatte nirgends eine Fehlergrenze -- aus jedem Fehler wurde damit
 * ein leerer Rahmen, ohne Hinweis und ohne Weg zurueck.
 *
 * ─── WARUM HIER DER QUELLTEXT GEPRUEFT WIRD ─────────────────────────────────
 * Dieses Projekt rendert in Unit-Tests keine Komponenten; eine Test-Bibliothek
 * dafuer gibt es nicht, und eine Abhaengigkeit fuer einen Test waere
 * unverhaeltnismaessig (sie ginge zusaetzlich durch das Lizenz-Gate).
 *
 * Das eigentliche Risiko ist ohnehin nicht der Text auf dem Bildschirm,
 * sondern ob die Grenze EINGEHAENGT ist. Eine Fehlergrenze, die irgendwo
 * herumliegt und den Baum nicht umschliesst, faengt nichts -- genau die Sorte
 * Luecke, die dieses Projekt schon mehrfach gekostet hat. Geprueft wird
 * deshalb beides: die reine Entscheidung und die Verdrahtung an BEIDEN
 * Einstiegspunkten (`main.tsx` und `shell/main.tsx`).
 *
 * Dieselbe Art struktureller Pruefung benutzt `yapaja_go/config.test.ts`
 * bereits fuer das Add-on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import CrashScreen from './CrashScreen.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(HIER, '..');

describe('die Entscheidung', () => {
  it('ein Fehler wird gemerkt', () => {
    const fehler = new Error('etwas ging schief');
    expect(CrashScreen.getDerivedStateFromError(fehler)).toEqual({ error: fehler });
  });

  it('und zwar der ECHTE -- nicht ein Ersatztext', () => {
    // Ohne den Originalfehler kann niemand weitergeben, was passiert ist,
    // und ein Absturz, den niemand beschreiben kann, ist nicht zu beheben.
    const fehler = new Error('Cannot read properties of undefined');
    expect(CrashScreen.getDerivedStateFromError(fehler).error?.message).toBe(
      'Cannot read properties of undefined',
    );
  });
});

describe('die Verdrahtung', () => {
  for (const einstieg of ['main.tsx', 'shell/main.tsx']) {
    it(`${einstieg} umschliesst den Baum mit der Fehlergrenze`, () => {
      const quelle = readFileSync(join(WEB_SRC, einstieg), 'utf-8');

      expect(quelle, 'die Grenze muss importiert sein').toContain('CrashScreen');
      // Oeffnendes UND schliessendes Element: ein blosser Import faengt nichts.
      expect(quelle).toContain('<CrashScreen>');
      expect(quelle).toContain('</CrashScreen>');

      // Und sie muss WIRKLICH umschliessen -- alles zwischen den beiden
      // Elementen ist geschuetzt, alles ausserhalb nicht.
      const auf = quelle.indexOf('<CrashScreen>');
      const zu = quelle.indexOf('</CrashScreen>');
      expect(zu, 'schliessendes Element nach dem oeffnenden').toBeGreaterThan(auf);
      expect(
        quelle.slice(auf, zu).trim().length,
        'zwischen den Elementen muss etwas stehen',
      ).toBeGreaterThan('<CrashScreen>'.length);
    });
  }
});
