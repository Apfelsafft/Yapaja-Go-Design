/**
 * Strukturwächter für das Regionen-Panel.
 *
 * ─── DIE SACKGASSE, DIE ES HIER GAB ─────────────────────────────────────────
 * Der Knopf „Routing bauen" stand ausschliesslich im Abschnitt „Verfuegbare
 * Regionen". Sobald die KACHELN einer Region gebaut sind, wandert sie aber in
 * „Installierte Regionen" -- und war damit aus dem Katalog-Abschnitt
 * verschwunden, mitsamt dem einzigen Weg zum Routinggraphen.
 *
 * Der Routinggraph ist ein ZWEITES, unabhaengiges Erzeugnis: wer die Karte
 * gebaut hat, hat noch lange kein Routing. Im Betrieb sah das so aus: Karte
 * fertig, Routing fehlt laut Installationspruefung, und in der Oberflaeche
 * kein Knopf dafuer. Der Betreiber versuchte daraufhin, die Karte zu
 * loeschen, um den Knopf zurueckzubekommen -- was die Letzte-Region-Regel
 * (zu Recht) ebenfalls verweigert. Eine Sackgasse mit zwei Waenden.
 *
 * ─── WARUM EIN STRUKTURTEST UND KEIN RENDER-TEST ────────────────────────────
 * Dieses Projekt hat keine React-Testing-Library eingerichtet, und sie allein
 * dafuer einzufuehren waere unverhaeltnismaessig. Der Test liest deshalb die
 * Quelle und prueft die EINE Eigenschaft, die hier gefehlt hat: dass beide
 * Abschnitte einen Weg zum Routingbau anbieten. Das ist schwaecher als ein
 * gerenderter Baum -- aber es haette genau diesen Fehler gefangen, und das
 * ist der Zweck. Dieselbe Bauart nutzen `yapaja_go/config.test.ts` (liest den
 * Dockerfile) und `preflight.test.ts` (liest die Frontend-Quelle).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(__dirname, 'RegionsPanel.tsx'), 'utf-8');

/** Der Abschnitt, der die INSTALLIERTEN Regionen rendert: von `installed.map(`
 *  bis zum Beginn des Katalog-Abschnitts. */
function installedSection(): string {
  const start = SOURCE.indexOf('installed.map(');
  expect(start, 'installed.map( nicht gefunden -- Panel umgebaut?').toBeGreaterThan(-1);
  const end = SOURCE.indexOf('Verfügbare Regionen', start);
  expect(end, 'Katalog-Abschnitt nicht gefunden').toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

/** Der Abschnitt, der den KATALOG rendert. */
function catalogSection(): string {
  const start = SOURCE.indexOf('Verfügbare Regionen');
  expect(start).toBeGreaterThan(-1);
  return SOURCE.slice(start);
}

describe('RegionsPanel: der Weg zum Routinggraphen darf nicht verschwinden', () => {
  it('installierte Regionen bieten einen Knopf zum Routingbau', () => {
    expect(
      installedSection(),
      'Im Abschnitt „Installierte Regionen" fehlt der Routingbau. Genau dorthin ' +
        'wandert eine Region, sobald ihre Kacheln gebaut sind — ohne den Knopf ' +
        'gibt es dann keinen Weg mehr zum Routinggraphen.',
    ).toContain('graph-build-button-');
  });

  it('installierte Regionen rufen dafür handleGraphBuild auf, nicht den Kachelbau', () => {
    const section = installedSection();
    expect(section).toContain('handleGraphBuild');
    // Ein Kachelbau waere hier sinnlos: die Kacheln sind ja schon da.
    expect(section).not.toContain('handleBuild(');
  });

  it('noch nicht installierte Regionen bieten den Routingbau ebenfalls an', () => {
    // Beide Wege muessen offen sein: manche bauen erst die Karte und dann das
    // Routing, andere gleich beides.
    expect(catalogSection()).toContain('graph-build-button-');
  });

  it('ein laufender Bau zeigt auch bei installierten Regionen seinen Fortschritt', () => {
    // Ein mehrminuetiger Lauf ohne jede Anzeige ist von einem Haenger nicht zu
    // unterscheiden. Die Fortschrittsanzeige lag frueher nur im
    // Katalog-Abschnitt -- also gerade nicht dort, wo der Routingbau
    // stattfindet.
    expect(installedSection()).toContain('JobProgress');
  });
});
