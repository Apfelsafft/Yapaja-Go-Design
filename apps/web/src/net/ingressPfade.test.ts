/**
 * Keine Adresse ab der Domainwurzel — Yapaia läuft unter einem Unterpfad.
 *
 * ─── DER FEHLER, DEN DAS FINDET ─────────────────────────────────────────────
 * Unter Home Assistant Ingress wird Yapaia nicht unter `/` ausgeliefert,
 * sondern unter
 *
 *     /api/hassio_ingress/<token>/
 *
 * Eine Anfrage an `"/api/v1/..."` — mit führendem Schrägstrich — verlässt
 * dieses Verzeichnis und landet bei Home Assistant selbst. Sie schlägt dann
 * nicht laut fehl, sondern bringt eine fremde Antwort oder eine 404, und das
 * betroffene Stück der Oberfläche bleibt einfach leer.
 *
 * ─── WARUM ES DIESE PRÜFUNG GIBT ────────────────────────────────────────────
 * Weil es schon zweimal passiert ist. Einmal bei der Lovelace-Karte, einmal
 * bei den Entsorgungsstationen in 0.13.0 — dort stand `fetch('/api/v1/map/
 * sonderziele')`, und auf jedem Ingress-Zugang wäre die ganze Ebene lautlos
 * weggeblieben.
 *
 * Gefunden hat es beide Male `e2e/subpath.spec.ts`. Das ist die richtige
 * Prüfung und sie bleibt: sie sieht die tatsächlichen Anfragen eines echten
 * Browsers, und nur sie kann das. Aber sie läuft sechs Minuten und erst in
 * der CI. Diese hier braucht Millisekunden und nennt die Datei und die Zeile.
 *
 * ─── WAS SIE NICHT KANN ─────────────────────────────────────────────────────
 * Sie liest Text, sie führt nichts aus. Eine Adresse, die erst zur Laufzeit
 * zusammengesetzt wird, sieht sie nicht. Sie ersetzt `subpath.spec.ts` also
 * nicht, sondern nimmt ihr die häufigste Ursache ab.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUELLE = join(dirname(fileURLToPath(import.meta.url)), '..');

function alleQuelldateien(verzeichnis: string): string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) {
      gefunden.push(...alleQuelldateien(pfad));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(eintrag)) continue;
    // Prüfdateien dürfen absolute Adressen enthalten: dort sind sie
    // Beispieldaten, keine Anfragen. Diese Datei selbst erst recht — sie
    // zitiert den Fehler, den sie sucht.
    if (/\.test\.tsx?$/.test(eintrag)) continue;
    gefunden.push(pfad);
  }
  return gefunden;
}

/**
 * Eine Zeile, die `fetch` mit einer Adresse ab der Wurzel aufruft.
 *
 * Gesucht wird nur der eindeutige Fall: unmittelbar hinter `fetch(` ein
 * Anführungszeichen und ein Schrägstrich. Das ist absichtlich eng — eine
 * Prüfung, die zu viel meldet, wird abgeschaltet.
 */
const WURZELADRESSE = /fetch\(\s*['"`]\//;

/**
 * Ist diese Zeile ein Kommentar?
 *
 * ─── WARUM DAS SEIN MUSS ────────────────────────────────────────────────────
 * Ohne diese Ausnahme schlägt die Prüfung auf der Begründung an, die den
 * Fehler zitiert — `sonderzieleClient.ts` erklärt in einem Kommentar, dass
 * dort einmal `fetch("/api/v1/...")` stand.
 *
 * Ein Wächter, der das verbietet, verbietet die Erklärung. Dann verschwindet
 * beim nächsten Mal der Kommentar statt des Fehlers, und die Erfahrung ist
 * weg. GENAU DASSELBE ist in derselben Sitzung schon der Prüfung in
 * `esphome/test/geheimnisse.test.ts` passiert.
 *
 * Es ist also keine Eigenart dieser beiden Dateien, sondern die Regel: wer
 * Quelltext nach einem Muster durchsucht, muss die Kommentare auslassen,
 * sonst verbietet er, über das Muster zu schreiben.
 *
 * Grob, aber für diesen Zweck genau genug: ein `fetch(` mitten in einer Zeile
 * hinter Code UND einem `//` ist kein Fall, den es hier gibt.
 */
function istKommentar(zeile: string): boolean {
  const t = zeile.trimStart();
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
}

describe('keine Anfrage verlässt den Ingress-Unterpfad', () => {
  it('kein `fetch` beginnt mit einem Schrägstrich', () => {
    const treffer: string[] = [];
    for (const datei of alleQuelldateien(QUELLE)) {
      const zeilen = readFileSync(datei, 'utf-8').split('\n');
      zeilen.forEach((zeile, i) => {
        if (!istKommentar(zeile) && WURZELADRESSE.test(zeile)) {
          treffer.push(`${relative(QUELLE, datei)}:${i + 1}  ${zeile.trim()}`);
        }
      });
    }

    expect(
      treffer,
      'Diese Anfragen gehen ab der Domainwurzel und landen unter Home ' +
        'Assistant Ingress nicht bei Yapaia. Statt "/api/v1/x" gehört dort ' +
        '`${import.meta.env.BASE_URL}api/v1/x` hin — OHNE führenden ' +
        'Schrägstrich, sonst ist die Ersetzung wirkungslos.\n' +
        treffer.join('\n'),
    ).toEqual([]);
  });

  it('die Prüfung findet den Fehler, den sie sucht', () => {
    // ─── DIE GEGENPROBE ─────────────────────────────────────────────────────
    // Ein Wächter, der nie anschlägt, ist von einem kaputten nicht zu
    // unterscheiden. Genau dieser Fall — eine Prüfung, die in Wahrheit gar
    // nichts prüfte — ist in diesem Projekt schon vorgekommen.
    expect(WURZELADRESSE.test(`fetch('/api/v1/map/sonderziele')`)).toBe(true);
    expect(WURZELADRESSE.test('fetch("/api/v1/x", { method: "POST" })')).toBe(true);
    expect(WURZELADRESSE.test('fetch( `/tiles/x` )')).toBe(true);
  });

  it('ein Kommentar, der den Fehler zitiert, ist kein Fehler', () => {
    // Die Begründung in `sonderzieleClient.ts` nennt die alte, falsche Zeile
    // beim Namen. Das muss sie dürfen.
    expect(istKommentar(` * Hier stand \`fetch("/api/v1/x")\`.`)).toBe(true);
    expect(istKommentar(`  // fetch('/api/v1/x') war falsch`)).toBe(true);
    expect(istKommentar(`  const a = await fetch('/api/v1/x');`)).toBe(false);
  });

  it('die richtige Schreibweise meldet sie NICHT', () => {
    // Sonst wäre der einzige Weg, sie ruhigzustellen, der falsche.
    expect(WURZELADRESSE.test(`fetch(apiUrl('api/v1/map/sonderziele'))`)).toBe(false);
    expect(WURZELADRESSE.test('fetch(`${import.meta.env.BASE_URL}api/v1/x`)')).toBe(false);
    // Eine vollständige Adresse ist kein Unterpfad-Problem: sie zeigt
    // ohnehin woandershin, und das ist eine andere Frage.
    expect(WURZELADRESSE.test(`fetch('https://example.invalid/x')`)).toBe(false);
  });

  it('sie sieht überhaupt Dateien an', () => {
    // Ein Verzeichnis, das sich einmal verschiebt, macht aus dieser Prüfung
    // sonst eine, die still über eine leere Liste läuft und grün meldet.
    const dateien = alleQuelldateien(QUELLE);
    expect(dateien.length).toBeGreaterThan(50);
    expect(dateien.some((d) => d.endsWith('sonderzieleClient.ts'))).toBe(true);
  });
});
