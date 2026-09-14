#!/usr/bin/env node
/**
 * Gibt es die Extrakte im Regionen-Katalog wirklich?
 *
 * ─── WARUM DAS EIN EIGENES WERKZEUG IST ─────────────────────────────────────
 * Der Katalog trug schon einmal Adressen, die es nicht gab. Der Modulkommentar
 * in `apps/core/src/map/regions/catalog.ts` beschreibt es: zwei Eintraege mit
 * `…-latest.pmtiles`, entstanden, indem an einer funktionierenden
 * `.osm.pbf`-Adresse die Endung getauscht wurde. Sie lieferten 404 -- und die
 * Oberflaeche bot trotzdem einen „Herunterladen"-Knopf an, der sicher
 * scheiterte.
 *
 * Mit 49 Eintraegen ist das kein Einzelfallrisiko mehr, sondern eine Frage der
 * Zeit: ein Tippfehler in einem Laendernamen faellt beim Lesen nicht auf, beim
 * Betreiber aber sofort -- Stunden nachdem er „Karte bauen" gedrueckt hat.
 *
 * Geprueft wird per HEAD, nicht per Download: es geht um die Existenz, nicht
 * um den Inhalt. 49 HEAD-Anfragen kosten Sekunden.
 *
 * ─── UND WARUM NICHT IN DER PER-PR-CI ───────────────────────────────────────
 * Weil es eine FREMDE Seite befragt. Ein Ausfall bei Geofabrik wuerde sonst
 * jeden Pull Request blockieren, ohne dass an Yapaia etwas falsch waere -- und
 * Geofabrik hat in diesem Projekt schon zweimal einen Merge-Blocker haengen
 * lassen. Der Lauf gehoert deshalb in den woechentlichen Nightly.
 *
 *   node scripts/check-region-catalog.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KATALOG = join(__dirname, '..', 'apps', 'core', 'src', 'map', 'regions', 'regions-catalog.json');

/** Wie lange eine einzelne Anfrage hoechstens dauern darf. */
const TIMEOUT_MS = 20_000;
/** Wie viele gleichzeitig. Hoeflich bleiben -- es ist eine fremde Seite. */
const PARALLEL = 4;

/**
 * Das Urteil zu EINER Antwort -- rein, damit es ohne Netz pruefbar ist.
 *
 * `405` gilt als vorhanden: manche Server lehnen HEAD ab, ohne dass die Datei
 * fehlt. Das als Fehler zu werten, waere ein Fehlalarm ueber unsere eigene
 * Anfragemethode.
 */
export function urteil(status) {
  if (status === 405 || status === 501) return { ok: true, hinweis: 'HEAD nicht erlaubt, Datei gilt als vorhanden' };
  if (status >= 200 && status < 400) return { ok: true, hinweis: '' };
  if (status === 404 || status === 410) return { ok: false, hinweis: 'gibt es nicht' };
  return { ok: false, hinweis: `unerwarteter Status ${status}` };
}

async function pruefe(eintrag) {
  const steuerung = new AbortController();
  const uhr = setTimeout(() => steuerung.abort(), TIMEOUT_MS);
  try {
    const antwort = await fetch(eintrag.pbfUrl, { method: 'HEAD', signal: steuerung.signal });
    return { ...urteil(antwort.status), id: eintrag.id, url: eintrag.pbfUrl, status: antwort.status };
  } catch (fehler) {
    return {
      ok: false,
      id: eintrag.id,
      url: eintrag.pbfUrl,
      status: 0,
      hinweis: `nicht erreichbar: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
    };
  } finally {
    clearTimeout(uhr);
  }
}

async function main() {
  const eintraege = JSON.parse(await readFile(KATALOG, 'utf-8')).filter((e) => e.pbfUrl);
  console.log(`Prüfe ${eintraege.length} Katalog-Adressen …\n`);

  const ergebnisse = [];
  for (let i = 0; i < eintraege.length; i += PARALLEL) {
    ergebnisse.push(...(await Promise.all(eintraege.slice(i, i + PARALLEL).map(pruefe))));
  }

  const kaputt = ergebnisse.filter((e) => !e.ok);
  for (const e of ergebnisse.sort((a, b) => a.id.localeCompare(b.id))) {
    const zeichen = e.ok ? '✓' : '✗';
    console.log(`${zeichen} ${e.id.padEnd(30)} ${String(e.status).padStart(3)} ${e.hinweis}`);
  }

  if (kaputt.length > 0) {
    console.error(`\n::error::${kaputt.length} Katalog-Adresse(n) stimmen nicht:`);
    for (const e of kaputt) console.error(`  ${e.id}: ${e.url} -- ${e.hinweis}`);
    console.error(
      '\nEin Eintrag, den es nicht gibt, ist in der Oberfläche ein Knopf, der\n' +
        'sicher fehlschlägt -- und zwar erst, nachdem der Betreiber ihn gedrückt hat.',
    );
    process.exit(1);
  }
  console.log(`\nAlle ${ergebnisse.length} Adressen vorhanden.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
