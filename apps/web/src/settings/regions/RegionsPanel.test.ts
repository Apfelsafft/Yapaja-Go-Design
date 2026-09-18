/**
 * Strukturwächter für das Karten-Panel.
 *
 * ─── DIE SACKGASSE, DIE ES HIER GAB ─────────────────────────────────────────
 * Der Knopf „Routing bauen" stand ausschliesslich im Abschnitt „Verfügbare
 * Regionen". Sobald die KACHELN einer Region gebaut waren, wanderte sie aber
 * in „Installierte Regionen" — und war damit aus dem Katalog-Abschnitt
 * verschwunden, mitsamt dem einzigen Weg zum Routinggraphen.
 *
 * Im Betrieb sah das so aus: Karte fertig, Routing fehlt laut
 * Installationsprüfung, und in der Oberfläche kein Knopf dafür. Der Betreiber
 * versuchte daraufhin, die Karte zu löschen, um den Knopf zurückzubekommen —
 * was die Letzte-Region-Regel (zu Recht) ebenfalls verweigert. Eine Sackgasse
 * mit zwei Wänden.
 *
 * ─── WARUM DIESE DATEI SEIT 0.16.0 ANDERS AUSSIEHT ──────────────────────────
 * Die zwei Abschnitte gibt es nicht mehr; es ist EINE Liste, und der Bau von
 * Routing und Suche hängt an keinem Eintrag mehr, sondern an einem
 * gemeinsamen Knopf. Damit kann die alte Sackgasse baulich nicht wieder
 * entstehen.
 *
 * Die LEHRE bleibt und wird hier weiter geprüft, nur allgemeiner gefasst:
 *
 *   Von jedem Zustand, in den man geraten kann, muss ein Knopf wegführen.
 *
 * Geprüft werden deshalb: dass es den gemeinsamen Bau-Knopf gibt, dass er
 * nicht an einer einzelnen Karte hängt, dass Löschen IMMER erreichbar bleibt,
 * und dass ein fertiger oder laufender Vorgang sichtbar ist.
 *
 * ─── WARUM EIN STRUKTURTEST UND KEIN RENDER-TEST ────────────────────────────
 * Dieses Projekt hat keine React-Testing-Library eingerichtet, und sie allein
 * dafür einzuführen wäre unverhältnismässig. Der Test liest deshalb die
 * Quelle. Das ist schwächer als ein gerenderter Baum — aber es hätte genau
 * diese Fehler gefangen, und das ist der Zweck. Dieselbe Bauart nutzen
 * `yapaja_go/config.test.ts` (liest den Dockerfile) und `preflight.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(__dirname, 'RegionsPanel.tsx'), 'utf-8');

/**
 * Die Quelle ohne Kommentare.
 *
 * ─── WARUM ──────────────────────────────────────────────────────────────────
 * Dieselbe Falle ist in diesem Projekt schon zweimal zugeschnappt
 * (`geheimnisse.test.ts`, `ingressPfade.test.ts`): wer Quelltext nach einem
 * Muster durchsucht und Kommentare mitliest, VERBIETET, über das Muster zu
 * schreiben. Die Erklärung, warum Löschen nicht gesperrt wird, enthält
 * zwangsläufig das Wort, auf das geprüft wird.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((zeile) => !zeile.trim().startsWith('//'))
  .join('\n');

/** Der Block, der einen Listeneintrag rendert. */
function eintragsBlock(): string {
  const start = CODE.indexOf('karten.map(');
  expect(start, 'karten.map( nicht gefunden — Panel umgebaut?').toBeGreaterThan(-1);
  return CODE.slice(start);
}

describe('es gibt einen Weg zu Routing und Suche', () => {
  it('der gemeinsame Bau-Knopf ist da', () => {
    // Ohne ihn gäbe es nach einer Installation gar keinen Weg mehr zu
    // Routing und Suche — die Knöpfe an den einzelnen Karten sind weg.
    expect(CODE).toContain('gesamtbau-button');
    expect(CODE).toContain('handleGesamtbau');
  });

  it('er hängt an KEINER einzelnen Karte', () => {
    // ─── DIE ALTE SACKGASSE, BAULICH AUSGESCHLOSSEN ────────────────────────
    // Genau daran lag es: der Knopf gehörte einem Listeneintrag, und der
    // Eintrag wanderte. Steht er im Eintragsblock, kann dasselbe wieder
    // passieren.
    expect(
      eintragsBlock(),
      'Der gemeinsame Bau-Knopf steht wieder in einem Listeneintrag. Dann ' +
        'verschwindet er mit dem Eintrag — genau die Sackgasse von 0.10.x.',
    ).not.toContain('gesamtbau-button');
  });

  it('er sagt, wenn es noch nichts zu bauen gibt', () => {
    // Ein ausgegrauter Knopf ohne Begründung ist eine Wand.
    expect(CODE).toContain('gesamtbau-ohne-karte');
  });
});

describe('von jedem Zustand führt ein Knopf weg', () => {
  it('Löschen ist NIE gesperrt', () => {
    // ─── DIE FALLE, DIE ES HIER FAST GEGEBEN HÄTTE ─────────────────────────
    // Ein Bau dauert Stunden und kann hängen. Wäre Löschen währenddessen
    // gesperrt, käme man an keine Karte mehr heran, bis das Add-on neu
    // startet — und ein Add-on-Neustart ist genau die Art Ausweg, die auf dem
    // vorgesehenen Bedienweg niemand finden soll. Dieselbe Falle hat schon
    // einmal den Knopf „Kacheln bauen" blockiert (siehe `build.ts`).
    const block = eintragsBlock();
    const loeschen = block.indexOf('delete-button-');
    expect(loeschen, 'kein Löschen-Knopf gefunden').toBeGreaterThan(-1);
    // Der Knopf-Aufruf reicht rund zwanzig Zeilen vor die `data-testid`.
    const umfeld = block.slice(Math.max(0, loeschen - 800), loeschen);
    const knopfStart = umfeld.lastIndexOf('<button');
    expect(knopfStart, 'Löschen steht nicht in einem <button>').toBeGreaterThan(-1);
    expect(
      umfeld.slice(knopfStart),
      'Der Löschen-Knopf ist wieder an einen laufenden Vorgang gekoppelt. ' +
        'Bei einem hängenden Bau kommt man damit an keine Karte mehr heran.',
    ).not.toContain('disabled=');
  });

  it('eine selbst abgelegte Karte sagt, warum für sie nichts gebaut wird', () => {
    // Sie steht in keinem Katalog, der Gesamtbau überspringt sie. Stumm
    // übersprungen zu werden ist die Fehlerklasse, die dieses Projekt am
    // längsten verfolgt.
    expect(CODE).toContain('karte-fremd-');
  });
});

describe('ein Vorgang bleibt sichtbar', () => {
  it('ein fertiger Bau verschwindet nicht kommentarlos', () => {
    // Früher wurde die Anzeige bei `status === 'done'` weggefiltert: der
    // Balken verschwand, und übrig blieb eine Oberfläche wie vor dem Klick.
    // Ob der Bau geglückt oder still gestorben war, liess sich nicht
    // unterscheiden — man musste ins Add-on-Protokoll sehen.
    expect(CODE, 'Es fehlt die Erfolgsmeldung nach einem Einzelvorgang.').toContain('job-done-');
    expect(CODE, 'Es fehlt die Erfolgsmeldung nach dem Gesamtbau.').toContain('gesamtbau-fertig');
  });

  it('jeder Listeneintrag zeigt seinen Fortschritt', () => {
    // Ein mehrminütiger Lauf ohne jede Anzeige ist von einem Hänger nicht zu
    // unterscheiden.
    expect(eintragsBlock()).toContain('JobProgress');
  });

  it('der Gesamtbau zeigt Schritt UND Restzeit', () => {
    // Beides gehört dazu: der Schritt sagt, wo er steht, die Restzeit, ob
    // sich das Warten lohnt.
    expect(CODE).toContain('gesamtbau-schritt');
    expect(CODE).toContain('gesamtbau-restzeit');
  });

  it('die Restzeit wird NICHT in der Oberfläche gerechnet', () => {
    // ─── WARUM DAS HIER STEHT ──────────────────────────────────────────────
    // Der Kern liefert mit `restText` schon den fertigen Satz, samt der
    // Unterscheidung zwischen einer Schätzung („noch etwa") und einer
    // Untergrenze („mindestens noch"). Wer hier aus `restSekunden` selbst
    // einen Satz baut, verliert genau diese Unterscheidung — und eine
    // Untergrenze, die wie eine Schätzung aussieht, fällt immer zu kurz aus.
    expect(CODE).toContain('restText');
    expect(
      CODE,
      'Die Oberfläche rechnet wieder selbst in Minuten um. Dabei geht die ' +
        'Unterscheidung Schätzung/Untergrenze verloren — siehe bauzeit.ts.',
    ).not.toMatch(/restSekunden\s*\/\s*60/);
  });

  it('es steht etwas da, wenn es noch keine Erfahrungswerte gibt', () => {
    // Beim ERSTEN Bau einer Karte ist das der Normalfall. Ein leeres Feld
    // sähe aus wie ein Fehler.
    expect(CODE).toContain('Restzeit noch unbekannt');
  });
});
