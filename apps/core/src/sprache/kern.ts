/**
 * Die Sprachbefehle an die echten Dienste des Kerns anschließen.
 *
 * `dialog.ts` kennt nur `SprachDeps`; hier wird daraus Suche, Routing,
 * Navigation, „Unterwegs finden" und der Verkehrsabruf. Dieselbe Instanz
 * bedient den Mikrofon-Knopf in der App und Home Assistant Assist -- eine
 * offene Rückfrage („Soll ich losfahren?") gilt also für beide.
 */

import type { FastifyInstance } from 'fastify';
import type { LatLng, NavState, Route, SearchResult } from '@yapaia/shared';
import { Sprachdialog, type SprachDeps, type Treffer, type VerkehrsMeldung } from './dialog.js';
import { naechsteStationen } from '../bord/entlangRoute.js';
import { leseKandidaten, unterwegsKategorie } from '../search/unterwegs.js';
import { holeVerkehr, type VerkehrDeps } from '../online/verkehr.js';
import { onlineEingeschaltet } from '../online/routes.js';
import type { AnsageZiel, AnsagePrioritaet } from '../ha/beatAnsage.js';

/** So weit um die Position sucht „der nächste Aldi". */
export const UMKREIS_NAME_KM = 25;

/** Klein, ohne Akzente, ß→ss -- für den Namensvergleich. */
function faltungEinfach(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Eine Autobahnkennung wie „A 61" in Straßennamen und Ansagen. */
const AUTOBAHN = /\bA[\s-]?(\d{1,4})\b/gi;

export function autobahnenDerRoute(route: Route | null): string[] {
  const raus = new Set<string>();
  for (const m of route?.maneuvers ?? []) {
    const texte = [...((m as { street_names?: string[] }).street_names ?? [])];
    const ansage = (m as { instruction?: string }).instruction;
    if (ansage) texte.push(ansage);
    for (const t of texte) for (const treffer of String(t).matchAll(AUTOBAHN)) raus.add(`A${treffer[1]}`);
  }
  return [...raus].slice(0, 8);
}

export interface KernDienste {
  sucheOrte(q: string, nahe: LatLng | null, umkreisKm?: number): Promise<SearchResult[]>;
  routeZu(ziel: LatLng): Promise<Route>;
  starte(route: Route, ziel: { latlng: LatLng; name: string | null }): void;
  navigation: {
    getState(): NavState;
    pause(): unknown;
    resume(): unknown;
    stop(): unknown;
    getFortschritt(): Parameters<typeof naechsteStationen>[1]['route'];
    getActiveRoute(): Route | null;
  };
  position(): LatLng | null;
  verkehrDeps?: VerkehrDeps;
  zeitzone?: string;
}

export function sprachDeps(k: KernDienste): SprachDeps {
  const kandidatenCache = new Map<string, { bis: number; liste: ReturnType<typeof leseKandidaten> }>();
  return {
    async suche(text) {
      const treffer = await k.sucheOrte(text, k.position());
      return treffer.map((t) => ({
        name: t.name,
        beschreibung: t.label || t.name,
        lat: t.latlng.lat,
        lon: t.latlng.lon,
      }));
    },
    async naechsteNamens(name) {
      const p = k.position();
      if (!p) return [];
      const gesucht = faltungEinfach(name);
      const treffer = (await k.sucheOrte(name, p, UMKREIS_NAME_KM)).filter((t) =>
        // Nur, was wirklich so heißt: „Aldi" passt zu „ALDI Süd", nicht zu
        // einem Laden in der Aldinger Straße.
        ` ${faltungEinfach(t.name)}`.includes(` ${gesucht}`),
      );
      const kandidaten = treffer.map((t) => ({ name: t.label || t.name, lat: t.latlng.lat, lon: t.latlng.lon }));
      const route = k.navigation.getFortschritt();
      // Mit Route zuerst, was voraus an der Strecke liegt; sonst Luftlinie.
      let funde = route ? naechsteStationen(kandidaten, { route, position: p }, 3) : [];
      if (funde.length === 0) funde = naechsteStationen(kandidaten, { route: null, position: p }, 3);
      return funde.map((f) => ({
        name: f.name.split(',')[0]!.trim(),
        beschreibung: f.name,
        lat: f.lat,
        lon: f.lon,
        entfernung_m: f.voraus_m ?? f.abseits_m,
      }));
    },
    route: (ziel) => k.routeZu({ lat: ziel.lat, lon: ziel.lon }),
    starte: (route, ziel) => k.starte(route, { latlng: { lat: ziel.lat, lon: ziel.lon }, name: ziel.name }),
    navigation: () => k.navigation.getState(),
    pause: () => void k.navigation.pause(),
    weiter: () => void k.navigation.resume(),
    stopp: () => void k.navigation.stop(),
    naechste(kategorieId) {
      const kat = unterwegsKategorie(kategorieId);
      if (!kat) return [];
      const jetzt = Date.now();
      let e = kandidatenCache.get(kat.id);
      if (!e || e.bis < jetzt) {
        e = { bis: jetzt + 10 * 60_000, liste: leseKandidaten(kat) };
        kandidatenCache.set(kat.id, e);
      }
      const p = k.position();
      const route = k.navigation.getFortschritt();
      return naechsteStationen(e.liste, { route, position: p }, 3).map((f) => ({
        name: f.name,
        beschreibung: f.name,
        lat: f.lat,
        lon: f.lon,
        entfernung_m: f.voraus_m ?? f.abseits_m,
      }));
    },
    async verkehr() {
      if (!onlineEingeschaltet()) {
        return { fehler: 'Verkehrsmeldungen brauchen die Online-Dienste. Schalte in der Add-on-Konfiguration „online" ein.' };
      }
      const route = k.navigation.getActiveRoute();
      const strassen = autobahnenDerRoute(route);
      if (strassen.length === 0) return { meldungen: [] };
      const befund = await holeVerkehr(strassen, k.verkehrDeps);
      const mitOrt = befund.meldungen.filter(
        (m): m is typeof m & { lat: number; lon: number } => typeof m.lat === 'number' && typeof m.lon === 'number',
      );
      const fortschritt = k.navigation.getFortschritt();
      // Dieselbe Lage-Rechnung wie bei den Bordsensoren: nur, was voraus und
      // nah an der Strecke liegt, mit dem Weg dorthin.
      const lage = naechsteStationen(
        mitOrt.map((m) => ({ name: m.id, lat: m.lat, lon: m.lon })),
        { route: fortschritt, position: k.position() },
        20,
      );
      const nachId = new Map(mitOrt.map((m) => [m.id, m]));
      const meldungen: VerkehrsMeldung[] = lage
        .filter((f) => f.abseits_m <= 600)
        .map((f) => {
          const m = nachId.get(f.name)!;
          return { titel: m.titel, beschreibung: m.beschreibung, voraus_m: f.voraus_m };
        });
      return { meldungen };
    },
    uhrzeit: (iso) =>
      new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        ...(k.zeitzone ? { timeZone: k.zeitzone } : {}),
      }).format(new Date(iso)),
    jetzt: () => Date.now(),
  };
}

/** POST /api/v1/sprache -- ein Satz rein, Antwort (und ggf. Aktion) raus. */
export function registriereSprache(
  fastify: FastifyInstance,
  dialog: Sprachdialog,
  ansageZiel?: AnsageZiel,
): void {
  fastify.post<{ Body: unknown }>('/api/v1/sprache', async (request, reply) => {
    const body = (request.body ?? {}) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 500) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '"text" (1–500 Zeichen) fehlt' } });
    }
    const antwort = await dialog.verarbeite(text);
    fastify.log.info({ absicht: antwort.absicht }, `sprache: „${text}" → ${antwort.antwort}`);
    // Läuft das Radio, spricht Yapaia Beat die Antwort ins Radio -- die App
    // liest sie dann nicht noch einmal vor.
    const gesprochen = (await ansageZiel?.sage(antwort.antwort, 'hinweis')) ?? false;
    return reply.code(200).send({ data: { ...antwort, gesprochen } });
  });

  // POST /api/v1/ansage -- die App will etwas sagen (Abbiege-Ansage,
  // Bordhinweis). Läuft das Radio, mischt Yapaia Beat die Ansage ein
  // (`ueber_radio: true`); sonst spricht die App selbst.
  fastify.post<{ Body: unknown }>('/api/v1/ansage', async (request, reply) => {
    const body = (request.body ?? {}) as { text?: unknown; prioritaet?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 500) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '"text" (1–500 Zeichen) fehlt' } });
    }
    const prioritaet: AnsagePrioritaet =
      body.prioritaet === 'navigation' || body.prioritaet === 'info' ? body.prioritaet : 'hinweis';
    const ueberRadio = (await ansageZiel?.sage(text, prioritaet)) ?? false;
    return reply.code(200).send({ data: { ueber_radio: ueberRadio } });
  });
}

export type { Treffer };
