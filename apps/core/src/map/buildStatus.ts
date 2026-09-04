/**
 * Was ist gebaut, und wann?
 *
 * ─── WOFUER ─────────────────────────────────────────────────────────────────
 * Gemeldet: „Nach der (erfolgreichen) Erstellung sehe ich nicht, dass bereits
 * etwas erstellt wurde und wann."
 *
 * Der Bau lief, die Meldung kam, und danach sah die Oberfläche wieder aus wie
 * vorher. Bei einem Vorgang, der für Deutschland Stunden dauert, ist das die
 * wichtigste Auskunft überhaupt — sonst baut man im Zweifel noch einmal.
 *
 * ─── DIE UNBEQUEME WAHRHEIT, DIE HIER SICHTBAR WIRD ─────────────────────────
 * Kacheln liegen PRO REGION (`<region>.pmtiles`). Routinggraph und Suchindex
 * gibt es dagegen nur EINMAL: beide Bauwege ersetzen den vorherigen Stand
 * vollständig (`yapaja-build-graph` tauscht das ganze Verzeichnis,
 * `yapaja-build-lite-index` die ganze Datei). Wer Routing für Region B baut,
 * hat danach kein Routing mehr für Region A.
 *
 * Die Oberfläche bietet die Knöpfe aber PRO REGION an und legte damit das
 * Gegenteil nahe. Diese Auskunft sagt deshalb ausdrücklich, AUS WELCHER
 * Region der eine Graph und der eine Index stammen — statt pro Region ein
 * Häkchen zu zeigen, das für alle anderen gelogen wäre.
 */

import { statSync, readFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Ein gebautes Artefakt: da oder nicht, und seit wann. */
export interface ArtifactStatus {
  present: boolean;
  /** Zeitpunkt des Baus (ISO 8601), soweit ermittelbar. */
  built_at?: string;
  /** Region, aus der es gebaut wurde. Fehlt bei Staenden von vor 0.3.9. */
  region?: string;
  size_bytes?: number;
  /** Zahl der Eintraege -- nur beim Suchindex. */
  record_count?: number;
}

export interface TileStatus extends ArtifactStatus {
  region: string;
}

export interface BuildStatus {
  /** Pro Region -- Kacheln sind das einzige Artefakt, das nebeneinander
   *  existieren kann. */
  tiles: TileStatus[];
  /** EINER fuer alle Regionen. */
  routing: ArtifactStatus;
  /** EINER fuer alle Regionen. */
  search: ArtifactStatus;
}

export interface BuildStatusPaths {
  tilesDir: string;
  /** Verzeichnis mit dem Valhalla-Graphen. */
  graphDir: string;
  liteSearchDbPath: string;
}

/** Liest `built_at`/`region` aus einer Datei, ohne je zu werfen. */
function readJsonInfo(path: string): { region?: string; built_at?: string } {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const obj = parsed as Record<string, unknown>;
    return {
      ...(typeof obj.region === 'string' ? { region: obj.region } : {}),
      ...(typeof obj.built_at === 'string' ? { built_at: obj.built_at } : {}),
    };
  } catch {
    return {};
  }
}

function mtimeIso(path: string): string | undefined {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return undefined;
  }
}

async function tileStatuses(tilesDir: string): Promise<TileStatus[]> {
  let entries: string[];
  try {
    entries = await readdir(tilesDir);
  } catch {
    return [];
  }
  const out: TileStatus[] = [];
  for (const file of entries) {
    if (!file.endsWith('.pmtiles')) continue;
    const full = join(tilesDir, file);
    try {
      const s = statSync(full);
      if (!s.isFile()) continue;
      out.push({
        region: file.slice(0, -'.pmtiles'.length),
        present: true,
        built_at: s.mtime.toISOString(),
        size_bytes: s.size,
      });
    } catch {
      // Eine Datei, die zwischen readdir und stat verschwindet, ist kein Fehler.
    }
  }
  return out.sort((a, b) => a.region.localeCompare(b.region));
}

/**
 * Der Zustand des Routinggraphen.
 *
 * `build-info.json` liegt NEBEN dem Kachelverzeichnis und wird vom Bau
 * geschrieben. Fehlt sie (Graph von vor 0.3.9), bleibt die Zeit des
 * Verzeichnisses als Naeherung -- die Region ist dann schlicht unbekannt und
 * wird auch so gemeldet, statt geraten zu werden.
 */
function routingStatus(graphDir: string): ArtifactStatus {
  if (!existsSync(graphDir)) return { present: false };

  let hasTiles = false;
  try {
    hasTiles = statSync(graphDir).isDirectory();
  } catch {
    return { present: false };
  }
  if (!hasTiles) return { present: false };

  const infoPath = join(graphDir, '..', 'build-info.json');
  const info = existsSync(infoPath) ? readJsonInfo(infoPath) : {};
  const builtAt = info.built_at ?? mtimeIso(graphDir);

  return {
    present: true,
    ...(builtAt ? { built_at: builtAt } : {}),
    ...(info.region ? { region: info.region } : {}),
  };
}

/**
 * Der Zustand des Suchindex.
 *
 * Gelesen wird die `meta`-Tabelle IM Index -- nicht der Zeitstempel der
 * Datei. Der Bau schreibt in eine temporaere Datei und benennt sie an ihren
 * Platz; welcher Zeitstempel dabei herauskommt, ist Sache des Dateisystems.
 * Was im Index steht, hat der Bau selbst hineingeschrieben.
 *
 * Der Zeitstempel der Datei bleibt der Rueckfall fuer Indizes von vor 0.3.9,
 * die noch keine `meta`-Tabelle haben.
 */
function searchStatus(dbPath: string, readMeta: MetaReader): ArtifactStatus {
  if (!existsSync(dbPath)) return { present: false };

  let size: number | undefined;
  try {
    size = statSync(dbPath).size;
  } catch {
    size = undefined;
  }

  const meta = readMeta(dbPath);
  const builtAt = meta.built_at ?? mtimeIso(dbPath);

  return {
    present: true,
    ...(builtAt ? { built_at: builtAt } : {}),
    ...(meta.region ? { region: meta.region } : {}),
    ...(size !== undefined ? { size_bytes: size } : {}),
    ...(meta.record_count !== undefined ? { record_count: meta.record_count } : {}),
  };
}

export interface IndexMeta {
  region?: string;
  built_at?: string;
  record_count?: number;
}

export type MetaReader = (dbPath: string) => IndexMeta;

export async function collectBuildStatus(
  paths: BuildStatusPaths,
  readMeta: MetaReader,
): Promise<BuildStatus> {
  return {
    tiles: await tileStatuses(paths.tilesDir),
    routing: routingStatus(paths.graphDir),
    search: searchStatus(paths.liteSearchDbPath, readMeta),
  };
}
