/**
 * Read-side access to an already-built `lite_search.db` (E05-T5, W-12).
 * Opened lazily, read-only (`fileMustExist: true` -- a missing file is a
 * clear "index not built yet" signal, not a silently-empty index), and kept
 * open across calls (closed explicitly via `close()`, mirroring
 * `apps/core/src/db/index.ts`'s singleton-with-explicit-close shape).
 */
import Database from 'better-sqlite3';
import { LITE_KINDS, type LiteCandidate, type LiteKind } from './ranking.js';

interface LiteSearchRow {
  name: string;
  kind: string;
  lat: number;
  lon: number;
  ftsRank: number;
  category: string | null;
  address: string | null;
  locality: string | null;
  postcode: string | null;
}

interface LiteAllRow {
  name: string;
  kind: string;
  lat: number;
  lon: number;
  category: string | null;
  address: string | null;
  locality: string | null;
}

// Aus der EINEN Liste abgeleitet (ranking.ts), nicht abgeschrieben. Die
// abgeschriebene Fassung hier hat beim Hinzufuegen von `poi` genau eine
// Aenderung verpasst und damit alle Sonderziele lautlos aus jedem
// Suchergebnis entfernt.
const KNOWN_KINDS: ReadonlySet<string> = new Set<string>(LITE_KINDS);

function isLiteKind(kind: string): kind is LiteKind {
  return KNOWN_KINDS.has(kind);
}

/**
 * Ein einzelner Begriff als FTS5-Phrase.
 *
 * Die Anfuehrungszeichen sind das, was beliebige Nutzereingaben (`"`,
 * `AND`/`OR`/`NOT`, `*`, `:`, `-`, ...) davor bewahrt, als FTS5-Abfragesprache
 * gelesen zu werden -- es bleibt immer buchstaeblicher Text, in dem der
 * Trigramm-Tokenizer Teilzeichenketten sucht, nie ein Operator.
 */
function escapeFtsTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * Die ganze Eingabe als FTS5-Abfrage.
 *
 * ─── DER FEHLER, DEN DAS BEHEBT ─────────────────────────────────────────────
 * Hier stand die GESAMTE Eingabe in einem einzigen Anfuehrungszeichen-Paar --
 * also als EINE zusammenhaengende Zeichenfolge. Damit scheiterte jede Suche
 * aus mehr als einem Wort, auch wenn beide Angaben stimmten:
 *
 *     „Eschenweg Germersheim"  ->  0 Treffer
 *     „eschenweg 2"            ->  0 Treffer
 *
 * Denn „Eschenweg" enthaelt weder „g G" noch „g 2". Gemessen, nicht vermutet.
 *
 * Gemeldet wurde: „Ich habe beispielsweise den Eschenweg in Sondernheim
 * (Germersheim) gesucht. Der wurde nicht gefunden. [...] Ich habe eschenweg 2
 * eingegeben und das wurde auch nicht gefunden." Und der Wunsch dahinter:
 * „eine smarte Suche, die ueber alle Aspekte einer Adresse Ergebnisse
 * liefert."
 *
 * ─── WARUM UND UND NICHT ODER ───────────────────────────────────────────────
 * Jeder Begriff muss vorkommen. Mit ODER waere „Eschenweg Germersheim" die
 * Liste aller Eschenwege PLUS aller Germersheimer Eintraege -- mehr Treffer,
 * aber keine besseren: die zweite Angabe soll ja EINGRENZEN.
 *
 * Wer eine Wortgruppe wirklich zusammenhaengend sucht, kann sie weiterhin
 * selbst in Anfuehrungszeichen setzen -- die bleiben erhalten.
 */
export function escapeFtsQuery(query: string): string {
  const terms = splitQueryTerms(query);
  if (terms.length === 0) return escapeFtsTerm(query.trim());
  return terms.map(escapeFtsTerm).join(' AND ');
}

/**
 * Zerlegt die Eingabe in Begriffe.
 *
 * Was der Nutzer selbst in Anfuehrungszeichen setzt, bleibt ein Stueck --
 * `"Sankt Martin" kirche` sind zwei Begriffe, nicht drei.
 *
 * Zu kurze Bruchstuecke fallen weg: der Trigramm-Tokenizer braucht drei
 * Zeichen, ein zweibuchstabiges Wort koennte nie treffen und wuerde mit UND
 * verknuepft die ganze Suche leer machen. „Weg 12" soll den Weg finden, nicht
 * nichts.
 */
export function splitQueryTerms(query: string): string[] {
  const terms: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(query)) !== null) {
    const term = (match[1] ?? match[2] ?? '').trim();
    if (term.length >= MIN_QUERY_LENGTH) terms.push(term);
  }
  return terms;
}

/** SQLite FTS5's trigram tokenizer needs at least 3 characters to form a
 *  single trigram; anything shorter can never match. Callers upstream
 *  already gate on `SEARCH_MIN_CHARS` (3, see `apps/web/src/search/store.ts`)
 *  before ever reaching a backend, but this is defense-in-depth so a direct
 *  unit test / API call with a 1-2 char query gets a clean `[]` instead of
 *  an SQLite error. */
const MIN_QUERY_LENGTH = 3;

/**
 * Spalten, die es in `places` erst seit einer bestimmten Version gibt.
 *
 * ─── WARUM HIER NACHGESEHEN WIRD, STATT SIE VORAUSZUSETZEN ──────────────────
 * `category` kam mit 0.3.6, `address` und `locality` mit 0.3.9. Ein Index, der
 * VORHER gebaut wurde, hat sie nicht -- und die Abfrage brach mit
 *
 *     no such column: p.category
 *
 * ab. Nach oben durchgereicht wurde daraus ein Backend-Fehler, und die
 * Oberflaeche meldete „Nichts gefunden fuer …". Also: die Suche war nach dem
 * Update vollstaendig tot, und zwar fuer JEDEN, der einen aelteren Index
 * hatte -- ohne dass irgendwo stand, woran es lag.
 *
 * Einen Index neu zu bauen dauert bei einem grossen Extrakt Stunden. Ein
 * Schema-Wechsel darf das nicht erzwingen: gelesen wird, was da ist, und was
 * fehlt, ist eben `null`.
 */
const OPTIONAL_COLUMNS = ['category', 'address', 'locality', 'postcode'] as const;

/**
 * ─── WARUM HIER KEINE SPALTENGEWICHTE STEHEN ────────────────────────────────
 * Mit der zweiten Suchspalte (Ort, Adresse, PLZ) lag der Gedanke nahe, den
 * Namen per `bm25(lite_search, 10.0, 1.0)` staerker zu gewichten -- als
 * Antwort auf die Sorge, die vor 0.6.0 zum Weglassen der Adressdaten gefuehrt
 * hatte: „sonst faende 'Beethoven' jeden Laden in der Beethovenstrasse statt
 * der Strasse selbst".
 *
 * Die Gewichte standen hier auch schon. Drei Versuche, ihren Nutzen zu
 * belegen, blieben ergebnislos -- darunter einer, der eigens dafuer gebaut
 * war (langer Strassenname gegen kurzen Ladennamen mit passender Adresse).
 * In jedem Fall stand die Strasse ohnehin oben: bm25 bevorzugt kurze
 * Dokumente, und die endgueltige Reihenfolge macht `ranking.ts` (Namensanfang,
 * Art, Entfernung), nicht bm25.
 *
 * Eine Zahl, deren Wirkung sich nicht zeigen laesst, ist keine Einstellung,
 * sondern Zierde -- und beim naechsten Umbau glaubt ihr jemand. Sie ist
 * deshalb wieder draussen. Dass Strassen vor den Laeden darin stehen, halten
 * die Tests in `multiAspectSearch.test.ts` fest; sollte das je kippen, sind
 * Gewichte das erste Mittel.
 */

export class LiteIndexReader {
  private db: Database.Database | null = null;
  /** Welche der optionalen Spalten dieser Index wirklich hat. */
  private available: Set<string> | null = null;

  constructor(private readonly dbPath: string) {}

  private open(): Database.Database {
    if (this.db) return this.db;
    this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
    return this.db;
  }

  /** Einmal je geoeffneter Datei: welche optionalen Spalten gibt es? */
  private columns(db: Database.Database): Set<string> {
    if (this.available) return this.available;
    const info = db.prepare('PRAGMA table_info(places)').all() as Array<{ name: string }>;
    const present = new Set(info.map((row) => row.name));
    this.available = new Set(OPTIONAL_COLUMNS.filter((column) => present.has(column)));
    return this.available;
  }

  /** `p.<spalte> as <spalte>` fuer vorhandene Spalten, sonst `NULL as <spalte>`.
   *  So bleibt die Zeilenform gleich, egal wie alt der Index ist. */
  private selectList(db: Database.Database): string {
    const have = this.columns(db);
    return OPTIONAL_COLUMNS.map((column) =>
      have.has(column) ? `p.${column} as ${column}` : `NULL as ${column}`,
    ).join(', ');
  }

  /** Returns candidates for `ranking.ts` to sort/trim -- deliberately
   *  over-fetches (`limit * OVERFETCH_FACTOR`) so the ranking tiers (prefix,
   *  kind) have enough raw material to reorder before the caller trims to
   *  the actually-requested page size. */
  searchByPrefix(query: string, limit: number): LiteCandidate[] {
    if (query.trim().length < MIN_QUERY_LENGTH) return [];

    const db = this.open();
    const overfetch = Math.max(limit * 4, 20);
    const rows = db
      .prepare(
        `SELECT p.name as name, p.kind as kind, p.lat as lat, p.lon as lon,
                ${this.selectList(db)}, bm25(lite_search) as ftsRank
         FROM lite_search
         JOIN places p ON p.id = lite_search.rowid
         WHERE lite_search MATCH ?
         ORDER BY ftsRank
         LIMIT ?`,
      )
      .all(escapeFtsQuery(query), overfetch) as LiteSearchRow[];

    return rows.filter((r): r is LiteSearchRow & { kind: LiteKind } => isLiteKind(r.kind));
  }

  /** Nearest-neighbor lookup for reverse geocoding. The index has no
   *  spatial index (small LI/DE-scale datasets, see build-lite-index.sh's
   *  <1min/<400MB budgets) -- a coarse bounding-box pre-filter in SQL keeps
   *  the row count sane, then exact Haversine distance (via `ranking.ts`'s
   *  same formula, duplicated here on purpose -- see that file's comment on
   *  why this codebase copies the ~6-line Haversine per module rather than
   *  sharing it) picks the closest rows in JS. */
  nearest(lat: number, lon: number, limit: number): LiteCandidate[] {
    const db = this.open();
    // ~0.5 degrees is generously larger than any plausible LI/DE reverse-geocode
    // radius; if nothing falls inside it there's nothing nearby to find anyway.
    const boxDeg = 0.5;
    const rows = db
      .prepare(
        `SELECT p.name as name, p.kind as kind, p.lat as lat, p.lon as lon, ${this.selectList(db)}
         FROM places p
         WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
      )
      .all(lat - boxDeg, lat + boxDeg, lon - boxDeg, lon + boxDeg) as LiteAllRow[];

    const withDistance = rows
      .filter((r): r is LiteAllRow & { kind: LiteKind } => isLiteKind(r.kind))
      .map((r) => ({ ...r, distanceKm: haversineKm(lat, lon, r.lat, r.lon) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);

    // ftsRank has no meaning for a reverse lookup (there was no text query);
    // 0 keeps every candidate on equal footing for that ranking tier so
    // `rankLiteCandidates` falls straight through to the distance-bias tier.
    return withDistance.map((r) => ({
      name: r.name,
      kind: r.kind,
      lat: r.lat,
      lon: r.lon,
      ftsRank: 0,
      category: r.category,
      address: r.address,
      locality: r.locality,
    }));
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Liest die `meta`-Tabelle eines gebauten Index (Region, Bauzeitpunkt,
 * Anzahl). Wirft nie: ein Index von vor 0.3.9 hat diese Tabelle nicht, und
 * das ist kein Fehler, sondern schlicht „unbekannt". Die Übersicht meldet
 * dann den Zeitstempel der Datei und keine Region -- statt eine zu raten.
 */
export function readLiteIndexMeta(dbPath: string): {
  region?: string;
  built_at?: string;
  record_count?: number;
} {
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare('SELECT key, value FROM meta').all() as Array<{
      key: string;
      value: string;
    }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const count = map.get('record_count');
    const parsedCount = count !== undefined ? Number.parseInt(count, 10) : NaN;
    return {
      ...(map.get('region') ? { region: map.get('region') as string } : {}),
      ...(map.get('built_at') ? { built_at: map.get('built_at') as string } : {}),
      ...(Number.isFinite(parsedCount) ? { record_count: parsedCount } : {}),
    };
  } catch {
    return {};
  } finally {
    db?.close();
  }
}
