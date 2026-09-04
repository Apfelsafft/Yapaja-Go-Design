/**
 * `GeocoderBackend` for the offline `lite` fallback (E05-T5, Wargame W-12).
 * Queries an already-built `lite_search.db` (see `buildIndex.ts`/
 * `build-lite-index.sh`) via SQLite FTS5 (trigram tokenizer), applies
 * `ranking.ts`'s ranking contract, and maps to `SearchResult` with
 * `source: 'lite'`.
 *
 * Failure contract (mirrors `photonBackend.ts`/`nominatimBackend.ts`): every
 * failure -- most commonly "index not built yet" (no `lite_search.db` on
 * disk, e.g. a fresh install that never ran `build-lite-index.sh`) --
 * throws a typed `GeocoderBackendError('lite', ...)` so `SearchService` can
 * log it, mark this backend "degraded", and continue the chain (to
 * Nominatim, if online_fallback is on) rather than crash the request.
 *
 * No network involved at all -- this is local SQLite I/O only, consistent
 * with the app's fully-offline design.
 */
import { statSync } from 'fs';
import type { SearchResult } from '@yapaja/shared';
import { GeocoderBackendError } from '../errors.js';
import type { GeocoderBackend, ReverseQuery, SearchLogger, SearchQuery } from '../types.js';
import { LiteIndexReader } from './reader.js';
import { listLiteSearchDbFiles } from './paths.js';
import { rankLiteCandidates, type LiteCandidate } from './ranking.js';

const noopLogger: SearchLogger = { info: () => {}, warn: () => {}, error: () => {} };

export interface LiteBackendOptions {
  /** Verzeichnis mit den Suchindizes -- seit 0.5.0 einer JE REGION. */
  dbDir: string;
  logger?: SearchLogger;
  /** Test-Naht: ein fertiger Leser gewinnt gegen alles auf der Platte. */
  reader?: LiteIndexReader;
}

/**
 * `label`/`type` on the resulting `SearchResult`: the lite index carries no
 * administrative hierarchy (no "city, country" containment info -- see
 * `extract.ts`/`buildIndex.ts`'s schema), so `label` is simply the name and
 * `type` is the raw `kind` ('city'|'town'|'village'|'street'), which lines
 * up 1:1 with `apps/web/src/search/icons.ts`'s existing icon lookup keys.
 * This is a documented, intentional simplification (E05-T5: "Ranking
 * simpel", "keine Hausnummern") -- not a bug to fix later without a
 * corresponding index-schema change.
 */
function candidateToResult(candidate: LiteCandidate): SearchResult {
  const address = candidate.address ?? undefined;
  const locality = candidate.locality ?? undefined;
  // „REWE, Beethovenstraße 12, Worms" -- `label` ist laut Typ die VOLLE
  // Bezeichnung. Bisher stand hier nur der Name noch einmal, weshalb die
  // Vorschlagsliste jeden Treffer doppelt zeigte und nichts unterschied.
  const label = [candidate.name, address, locality].filter(Boolean).join(', ');
  return {
    name: candidate.name,
    label,
    ...(address ? { address } : {}),
    ...(locality ? { locality } : {}),
    latlng: { lat: candidate.lat, lon: candidate.lon },
    // Bei einem POI ist die KATEGORIE die nuetzlichere Auskunft: sie waehlt
    // das Symbol (⛽ 🏕️ statt eines allgemeinen 📌) und sagt in der Liste,
    // WAS der Treffer ist -- „REWE" allein verraet das nicht.
    type: candidate.category ?? candidate.kind,
    source: 'lite',
  };
}

/**
 * Schluessel, unter dem zwei Treffer als DERSELBE gelten.
 *
 * ─── WARUM ENTDOPPELT WERDEN MUSS ─────────────────────────────────────────
 * Landesextrakte ueberlappen an den Grenzen: Basel steckt im Schweizer UND im
 * deutschen Extrakt, Strassburg im franzoesischen und im deutschen. Ohne
 * Entdopplung stuende jede Grenzstadt zweimal in der Vorschlagsliste --
 * derselbe Ort, dieselben Koordinaten, zwei Zeilen.
 *
 * Fuenf Nachkommastellen sind rund ein Meter. Es ist DASSELBE OSM-Objekt in
 * beiden Extrakten, die Koordinaten sind also identisch; gerundet wird nur,
 * damit eine Gleitkomma-Abweichung nicht zwei Zeilen erzeugt.
 */
function dedupeKey(candidate: LiteCandidate): string {
  return `${candidate.name}|${candidate.kind}|${candidate.lat.toFixed(5)}|${candidate.lon.toFixed(5)}`;
}

function dedupe(candidates: readonly LiteCandidate[]): LiteCandidate[] {
  const seen = new Set<string>();
  const out: LiteCandidate[] = [];
  for (const candidate of candidates) {
    const key = dedupeKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export class LiteBackend implements GeocoderBackend {
  readonly source = 'lite' as const;
  private readonly dbDir: string;
  private readonly logger: SearchLogger;
  /** Ein Leser JE INDEXDATEI, mit der Kennung der Datei, die er offen hat. */
  private readonly readers = new Map<string, { reader: LiteIndexReader; identity: string }>();
  /** Test-Naht: ein hereingereichter Leser gewinnt und wird nie ausgetauscht. */
  private readonly injected?: LiteIndexReader;

  constructor(opts: LiteBackendOptions) {
    this.dbDir = opts.dbDir;
    this.logger = opts.logger ?? noopLogger;
    this.injected = opts.reader;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const readers = this.getReaders();
    // JEDER Index wird gefragt, nicht nur der der aktuellen Region. Wer an
    // der Grenze steht, sucht regelmaessig etwas auf der anderen Seite -- und
    // welche Region gerade „die richtige" ist, waere ohnehin eine Annahme.
    const candidates = this.withErrorMapping('search', () =>
      readers.flatMap((reader) => reader.searchByPrefix(query.q, query.limit)),
    );
    const origin = query.lat !== undefined && query.lon !== undefined ? { lat: query.lat, lon: query.lon } : undefined;
    return rankLiteCandidates(dedupe(candidates), query.q, origin)
      .slice(0, query.limit)
      .map(candidateToResult);
  }

  async reverse(query: ReverseQuery): Promise<SearchResult[]> {
    const readers = this.getReaders();
    const candidates = dedupe(
      this.withErrorMapping('reverse', () =>
        readers.flatMap((reader) => reader.nearest(query.lat, query.lon, query.limit)),
      ),
    );
    // No text query for a reverse lookup -- rank purely by distance
    // (reader.nearest already sorted by distance; rankLiteCandidates with an
    // empty query string keeps every candidate's prefix-tier equal, so the
    // existing sort order from `nearest()` is preserved through the
    // distance-bias tier).
    return rankLiteCandidates(candidates, '', { lat: query.lat, lon: query.lon })
      .slice(0, query.limit)
      .map(candidateToResult);
  }

  /**
   * Kennzeichnet die Datei, die gerade unter `dbPath` liegt.
   *
   * Die Inode-Nummer ist der entscheidende Teil: der Neubau schreibt in eine
   * temporaere Datei und benennt sie ueber die alte (`cli.ts`, W-17). Damit
   * steht am selben PFAD eine ANDERE Datei -- gleicher Name, neue Inode.
   * Groesse und Zeitstempel kommen dazu, falls ein Bauweg jemals in dieselbe
   * Datei schreiben sollte.
   */
  private static fileIdentity(path: string): string {
    const s = statSync(path);
    return `${s.ino}:${s.size}:${s.mtimeMs}`;
  }

  /**
   * ─── WARUM HIER NACHGESEHEN WIRD, STATT EINMAL ZU OEFFNEN ─────────────────
   * Ein einmal geoeffneter SQLite-Handle liest die Datei, die er beim
   * Oeffnen bekommen hat -- und zwar auch dann noch, wenn sie inzwischen
   * durch `rename(2)` ersetzt und aus dem Verzeichnis geloescht wurde. Der
   * Kernel haelt die alte Inode am Leben, solange jemand sie offen hat.
   *
   * Genau das ist beim Betreiber passiert: Suchindex fuer Liechtenstein
   * gebaut, gesucht (damit war der Leser offen), danach den Index fuer
   * Rheinland-Pfalz gebaut. Die Oberflaeche meldete „ab sofort nutzbar --
   * ohne Neustart", der Server beantwortete aber weiter JEDE Suche aus dem
   * Liechtensteiner Index. „Beethovenstraße" stand deutlich sichtbar auf der
   * Karte und war trotzdem nicht zu finden -- und ein erneuter Neubau half
   * nie, weil er den Handle nicht anfasst, sondern nur wieder die Datei
   * ersetzt.
   *
   * Ein `stat` pro Abfrage ist dagegen nichts: eine Suche entsteht durch
   * Tippen mit Entprellung, nicht in Schleifen.
   *
   * Bewusst NICHT ueber eine Benachrichtigung vom Bau-Job geloest: gebaut
   * wird in einem EIGENEN Prozess, und der Weg ueber die Oberflaeche ist nur
   * einer von mehreren. Wer die Datei austauscht, geht diesen Prozess nichts
   * an -- die Datei selbst ist die einzige verlaessliche Auskunft.
   */
  /**
   * Ein Leser je vorhandener Indexdatei -- frisch, wenn sie neu gebaut wurde.
   *
   * Die Dateiliste wird bei JEDER Abfrage neu gelesen. Das kostet ein
   * `readdir` und ein `stat` je Datei (bei einer Handvoll Regionen nichts)
   * und ist die einzige verlaessliche Auskunft: gebaut wird in einem EIGENEN
   * Prozess, und eine neu hinzugekommene Region soll sofort durchsuchbar
   * sein, ohne Neustart -- so, wie die Oberflaeche es zusagt.
   */
  private getReaders(): LiteIndexReader[] {
    if (this.injected) return [this.injected];

    const files = listLiteSearchDbFiles(this.dbDir);
    if (files.length === 0) {
      this.closeAll();
      this.logger.warn('Kein Suchindex gefunden -- „Suche bauen" wurde noch nicht ausgefuehrt', {
        dbDir: this.dbDir,
      });
      throw new GeocoderBackendError(
        'lite',
        'UNAVAILABLE',
        `Kein Suchindex unter ${this.dbDir} (\u201eSuche bauen\u201c noch nicht ausgefuehrt)`,
      );
    }

    // Leser zu Dateien, die es nicht mehr gibt (Region entfernt), schliessen.
    for (const path of [...this.readers.keys()]) {
      if (!files.includes(path)) {
        this.closeOne(path);
      }
    }

    const open: LiteIndexReader[] = [];
    for (const path of files) {
      let identity: string;
      try {
        identity = LiteBackend.fileIdentity(path);
      } catch {
        // Zwischen readdir und stat verschwunden -- kein Fehler, nur weg.
        this.closeOne(path);
        continue;
      }

      const existing = this.readers.get(path);
      if (existing && existing.identity === identity) {
        open.push(existing.reader);
        continue;
      }
      if (existing) {
        this.logger.info('Suchindex wurde neu gebaut -- oeffne die neue Datei', { path });
        this.closeOne(path);
      }
      const reader = new LiteIndexReader(path);
      this.readers.set(path, { reader, identity });
      open.push(reader);
    }

    if (open.length === 0) {
      throw new GeocoderBackendError('lite', 'UNAVAILABLE', `Kein lesbarer Suchindex unter ${this.dbDir}`);
    }
    return open;
  }

  private closeOne(path: string): void {
    const entry = this.readers.get(path);
    if (!entry) return;
    try {
      entry.reader.close();
    } catch {
      // Ein Handle, der sich nicht schliessen laesst, darf die naechste Suche
      // nicht verhindern -- er wird ohnehin gerade weggeworfen.
    }
    this.readers.delete(path);
  }

  private closeAll(): void {
    for (const path of [...this.readers.keys()]) this.closeOne(path);
  }

  private withErrorMapping<T>(op: 'search' | 'reverse', fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof GeocoderBackendError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Lite-Suchindex-Abfrage fehlgeschlagen (${op})`, { reason });
      throw new GeocoderBackendError('lite', 'BAD_RESPONSE', `Lite-Suchindex-Abfrage fehlgeschlagen: ${reason}`);
    }
  }
}
