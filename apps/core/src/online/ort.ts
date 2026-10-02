/* eslint-disable no-undef -- `fetch`/`AbortController`/`setTimeout`/
 * `clearTimeout`/`Buffer` sind Standard-Globale in Node 22; dieselbe
 * Begruendung wie in `verkehr.ts`. */

/**
 * Was online über einen Ort zu erfahren ist: OpenStreetMap-Angaben,
 * Wikipedia und Bilder.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gewünscht (Vorbild Google Maps): ein Tipp auf einen Pin zeigt Infos zum
 * Ort, „Internet vorausgesetzt" -- und auf Nachfrage „gerne auch Wikipedia,
 * Bilder, etc.".
 *
 * Offline steht auf der Karte nur, was in den Kacheln liegt: Name, Kategorie,
 * manchmal eine Adresse. Website, Telefon, Öffnungszeiten, Gebühren -- das
 * steht in OpenStreetMap, aber nicht in den Kacheln.
 *
 * ─── WARUM DER KERN FRAGT UND NICHT DER BROWSER ────────────────────────────
 * Die Seite darf nach ihrer Sicherheitsrichtlinie (`security/headers.ts`)
 * keinen fremden Server ansprechen und keine fremden Bilder laden. Das soll
 * so bleiben. Der Kern fragt deshalb selbst -- nur mit eingeschaltetem
 * `online.enabled` -- und gibt Bilder als `data:`-Adressen zurück.
 *
 * ─── DREI QUELLEN, KEINE MUSS ──────────────────────────────────────────────
 *  1. Overpass (OpenStreetMap): das Objekt am Punkt mit diesem Namen.
 *  2. Wikipedia: der Artikel, auf den OSM verweist, sonst ein Artikel in der
 *     Nähe, dessen Titel zum Namen passt. Ein beliebiger Artikel in der Nähe
 *     (der Ort, in dem die Tankstelle steht) wäre falsche Auskunft.
 *  3. Wikimedia Commons: Bilder im Umkreis -- ausdrücklich als „in der Nähe"
 *     beschriftet, weil sie nicht zwingend den Ort selbst zeigen.
 * Jede Quelle darf ausfallen; die Antwort enthält dann einfach weniger.
 */

export interface OrtAnfrage {
  lat: number;
  lon: number;
  name?: string;
}

export interface OsmAngaben {
  website?: string;
  telefon?: string;
  email?: string;
  oeffnungszeiten?: string;
  gebuehr?: string;
  beschreibung?: string;
  /** Weitere, für Camper nützliche Merkmale -- schon in Klartext. */
  merkmale: string[];
}

export interface WikipediaAngaben {
  titel: string;
  auszug: string;
  url: string;
}

export interface OrtBild {
  /** `data:image/...;base64,...` */
  daten: string;
  /** Wo das Bild herkommt (Seite mit Urheber und Lizenz). */
  quelle: string;
  /** `artikel` = Wikipedia-Bild des Ortes, `umgebung` = Commons in der Nähe. */
  art: 'artikel' | 'umgebung';
}

export interface OrtInfo {
  osm: OsmAngaben | null;
  wikipedia: WikipediaAngaben | null;
  bilder: OrtBild[];
}

export interface OrtDeps {
  fetchFn?: typeof fetch;
  zeitgrenzeMs?: number;
  /** Höchstens so viele Bilder. */
  maxBilder?: number;
}

const USER_AGENT = 'YapaiaGo/1 (Home-Assistant-Add-on; Offline-Navigation fuer Wohnmobile)';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const MAX_BILD_BYTES = 400_000;

/** Bekannte OSM-Merkmale, die für ein Wohnmobil zählen -- Schlüssel → Klartext. */
const MERKMALE: ReadonlyArray<[string, (v: string) => string | null]> = [
  ['motorhome', (v) => (v === 'yes' ? 'Wohnmobile erlaubt' : v === 'no' ? 'Keine Wohnmobile' : null)],
  ['caravans', (v) => (v === 'yes' ? 'Wohnwagen erlaubt' : null)],
  ['capacity', (v) => `${v} Stellplätze`],
  ['maxstay', (v) => `Höchstdauer: ${v}`],
  ['power_supply', (v) => (v === 'yes' ? 'Strom' : null)],
  ['drinking_water', (v) => (v === 'yes' ? 'Trinkwasser' : null)],
  ['water_point', (v) => (v === 'yes' ? 'Frischwasser' : null)],
  ['sanitary_dump_station', (v) => (v === 'yes' ? 'Entsorgung' : null)],
  ['toilets', (v) => (v === 'yes' ? 'Toiletten' : null)],
  ['shower', (v) => (v === 'yes' ? 'Duschen' : null)],
  ['internet_access', (v) => (v === 'wlan' || v === 'yes' ? 'WLAN' : null)],
  ['dog', (v) => (v === 'yes' ? 'Hunde erlaubt' : v === 'no' ? 'Keine Hunde' : null)],
  ['wheelchair', (v) => (v === 'yes' ? 'Rollstuhlgerecht' : null)],
];

/** Ein Aufruf mit Zeitgrenze, der nie wirft. */
async function rufe(
  fetchFn: typeof fetch,
  url: string,
  grenzeMs: number,
  init: RequestInit = {},
): Promise<Response | null> {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), grenzeMs);
  try {
    const antwort = await fetchFn(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers ?? {}) },
      signal: abbruch.signal,
    });
    return antwort.ok ? antwort : null;
  } catch {
    return null;
  } finally {
    clearTimeout(uhr);
  }
}

function zahl(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Für die Overpass-Abfrage: ein Name in Anführungszeichen, sicher maskiert. */
export function overpassText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ');
}

export function osmAusTags(tags: Record<string, string>): OsmAngaben {
  const erste = (...k: string[]): string | undefined => k.map((x) => tags[x]).find((v) => typeof v === 'string' && v);
  const merkmale: string[] = [];
  for (const [k, text] of MERKMALE) {
    const v = tags[k];
    if (typeof v !== 'string') continue;
    const t = text(v);
    if (t) merkmale.push(t);
  }
  const gebuehr = tags.charge ?? (tags.fee === 'yes' ? 'kostenpflichtig' : tags.fee === 'no' ? 'kostenlos' : undefined);
  return {
    website: erste('website', 'contact:website', 'url'),
    telefon: erste('phone', 'contact:phone'),
    email: erste('email', 'contact:email'),
    oeffnungszeiten: erste('opening_hours'),
    gebuehr,
    beschreibung: erste('description:de', 'description'),
    merkmale,
  };
}

/** Normalisiert für den Namensvergleich: Kleinbuchstaben, ohne Satzzeichen. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Passt ein Wikipedia-Titel zum Namen des Ortes? */
export function titelPasst(titel: string, name: string): boolean {
  const t = norm(titel.replace(/\s*\(.*\)$/, ''));
  const n = norm(name);
  if (!t || !n) return false;
  // Nur in EINE Richtung: der Titel darf den Namen enthalten („Burg
  // Gutenberg (Balzers)" für „Burg Gutenberg"), nicht umgekehrt -- sonst
  // wäre der Ortsartikel „Balzers" ein Treffer für „Aral Tankstelle Balzers".
  return t === n || (n.length >= 6 && t.includes(n));
}

async function holeOsm(
  a: OrtAnfrage,
  fetchFn: typeof fetch,
  grenzeMs: number,
): Promise<Record<string, string> | null> {
  const um = `around:${a.name ? 80 : 30},${a.lat},${a.lon}`;
  const filter = a.name ? `["name"="${overpassText(a.name)}"]` : `[~"^(amenity|tourism|shop|leisure)$"~"."]`;
  const abfrage = `[out:json][timeout:8];nwr(${um})${filter};out tags center 1;`;
  const antwort = await rufe(fetchFn, OVERPASS, grenzeMs, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(abfrage)}`,
  });
  if (!antwort) return null;
  try {
    const json = (await antwort.json()) as { elements?: Array<{ tags?: Record<string, string> }> };
    return json.elements?.find((e) => e.tags && Object.keys(e.tags).length > 0)?.tags ?? null;
  } catch {
    return null;
  }
}

async function holeWikipedia(
  a: OrtAnfrage,
  tags: Record<string, string> | null,
  fetchFn: typeof fetch,
  grenzeMs: number,
): Promise<{ angaben: WikipediaAngaben; bild?: string } | null> {
  let sprache = 'de';
  let titel: string | null = null;

  const verweis = tags?.wikipedia;
  const m = typeof verweis === 'string' ? /^([a-z]{2,3}):(.+)$/.exec(verweis) : null;
  if (m) {
    sprache = m[1]!;
    titel = m[2]!;
  } else if (a.name) {
    const geo = await rufe(
      fetchFn,
      `https://de.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${a.lat}%7C${a.lon}&gsradius=300&gslimit=5&format=json`,
      grenzeMs,
    );
    if (geo) {
      try {
        const json = (await geo.json()) as { query?: { geosearch?: Array<{ title: string }> } };
        titel = json.query?.geosearch?.map((g) => g.title).find((t) => titelPasst(t, a.name!)) ?? null;
      } catch {
        titel = null;
      }
    }
  }
  if (!titel) return null;

  const sum = await rufe(
    fetchFn,
    `https://${sprache}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titel.replace(/ /g, '_'))}`,
    grenzeMs,
  );
  if (!sum) return null;
  try {
    const j = (await sum.json()) as {
      title?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
      thumbnail?: { source?: string };
    };
    if (!j.extract) return null;
    return {
      angaben: {
        titel: j.title ?? titel,
        auszug: j.extract,
        url: j.content_urls?.desktop?.page ?? `https://${sprache}.wikipedia.org/wiki/${encodeURIComponent(titel)}`,
      },
      bild: j.thumbnail?.source,
    };
  } catch {
    return null;
  }
}

async function holeCommons(
  a: OrtAnfrage,
  fetchFn: typeof fetch,
  grenzeMs: number,
  anzahl: number,
): Promise<Array<{ url: string; seite: string }>> {
  const antwort = await rufe(
    fetchFn,
    `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${a.lat}%7C${a.lon}` +
      `&ggsradius=150&ggslimit=${anzahl}&ggsnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=320&format=json`,
    grenzeMs,
  );
  if (!antwort) return [];
  try {
    const j = (await antwort.json()) as {
      query?: { pages?: Record<string, { imageinfo?: Array<{ thumburl?: string; descriptionurl?: string }> }> };
    };
    return Object.values(j.query?.pages ?? {})
      .map((p) => p.imageinfo?.[0])
      .filter((i): i is { thumburl: string; descriptionurl: string } => !!i?.thumburl && !!i?.descriptionurl)
      .map((i) => ({ url: i.thumburl, seite: i.descriptionurl }));
  } catch {
    return [];
  }
}

/** Nur Bilder von Wikimedia, nur Bildformate, nur bis zu einer Größe. */
export function bildErlaubt(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'upload.wikimedia.org';
  } catch {
    return false;
  }
}

async function alsDatenAdresse(fetchFn: typeof fetch, url: string, grenzeMs: number): Promise<string | null> {
  if (!bildErlaubt(url)) return null;
  const antwort = await rufe(fetchFn, url, grenzeMs, { headers: { Accept: 'image/*' } });
  if (!antwort) return null;
  const typ = (antwort.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(typ)) return null;
  try {
    const puffer = Buffer.from(await antwort.arrayBuffer());
    if (puffer.length === 0 || puffer.length > MAX_BILD_BYTES) return null;
    return `data:${typ};base64,${puffer.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function holeOrtInfo(a: OrtAnfrage, deps: OrtDeps = {}): Promise<OrtInfo> {
  const fetchFn = deps.fetchFn ?? fetch;
  const grenze = deps.zeitgrenzeMs ?? 6000;
  const maxBilder = deps.maxBilder ?? 4;
  if (!zahl(a.lat) || !zahl(a.lon)) return { osm: null, wikipedia: null, bilder: [] };

  const [tags, commons] = await Promise.all([
    holeOsm(a, fetchFn, grenze),
    holeCommons(a, fetchFn, grenze, maxBilder),
  ]);
  const wiki = await holeWikipedia(a, tags, fetchFn, grenze);

  const kandidaten: Array<{ url: string; quelle: string; art: OrtBild['art'] }> = [];
  if (wiki?.bild) kandidaten.push({ url: wiki.bild, quelle: wiki.angaben.url, art: 'artikel' });
  for (const c of commons) kandidaten.push({ url: c.url, quelle: c.seite, art: 'umgebung' });

  const bilder: OrtBild[] = [];
  for (const k of kandidaten.slice(0, maxBilder)) {
    const daten = await alsDatenAdresse(fetchFn, k.url, grenze);
    if (daten) bilder.push({ daten, quelle: k.quelle, art: k.art });
  }

  return { osm: tags ? osmAusTags(tags) : null, wikipedia: wiki?.angaben ?? null, bilder };
}
