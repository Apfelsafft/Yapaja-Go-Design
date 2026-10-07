/* eslint-disable no-undef -- `fetch`/`Response`/`AbortController`/`setTimeout`/
 * `clearTimeout` sind Standard-Globale in Node 22 (typisiert ueber
 * @types/node); dieselbe Begruendung wie in `ha/client.ts`. */

/**
 * Die Schnittstelle zu den Online-Diensten.
 *
 *  - `GET  /api/v1/online/status`   -> was eingeschaltet ist, ohne etwas zu rufen
 *  - `POST /api/v1/online/diagnose` -> ruft die Dienste WIRKLICH und berichtet
 *  - `POST /api/v1/online/verkehr`  -> Baustellen und Sperrungen je Autobahn
 *  - `GET  /api/v1/tanken/preise`    -> Spritpreise der Gegend (Tankerkönig)
 *
 * ─── WARUM DIAGNOSE EIN POST IST ────────────────────────────────────────────
 * Weil sie das Haus verlässt. Ein GET sieht harmlos aus: Browser holen ihn
 * vor, Dienste prüfen ihn zur Erreichbarkeit, ein Dashboard fragt ihn im
 * Hintergrund ab. Nichts davon soll ungefragt Anfragen an einen fremden
 * Server auslösen. Ein POST wird nur geschickt, wenn jemand darauf gedrückt
 * hat.
 *
 * ─── UND WARUM ER OHNE SCHALTER NICHTS TUT ──────────────────────────────────
 * Yapaia ist eine OFFLINE-Navigation. Dass sie plötzlich nach draußen
 * telefoniert, darf nicht die Vorgabe sein, sondern eine Entscheidung. Ist
 * `online.enabled` aus, antwortet der Endpunkt mit 409 und sagt, wo der
 * Schalter sitzt -- statt still eine leere Liste zu liefern, aus der niemand
 * ableiten kann, ob es nichts zu melden gab oder ob gar nicht gefragt wurde.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ApiError } from '@yapaia/shared';
import { diagnoseAutobahn, gesamturteil, type DiagnoseDeps, type DiagnoseZeile } from './diagnose.js';
import { holeVerkehr, verkehrUrteil, type VerkehrBefund, type VerkehrDeps } from './verkehr.js';
import { VerkehrCache } from './verkehrCache.js';
import { holeOrtInfo, type OrtDeps, type OrtInfo } from './ort.js';
import { Tankerkoenig, TankerkoenigFehler, type Preisabfrage, type TankenDeps } from './tanken.js';

/** Der Tankerkönig-Schlüssel aus der Konfiguration, oder leer. */
export function tankerkoenigSchluessel(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TANKERKOENIG_API_KEY ?? '').trim();
}

/** Fährt Yapaia die Online-Dienste überhaupt? */
export function onlineEingeschaltet(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ONLINE_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export interface OnlineStatus {
  aktiv: boolean;
  /** Im Klartext, für die Oberfläche. */
  hinweis: string;
  dienste: Array<{ name: string; beschreibung: string; schluessel_noetig: boolean }>;
}

/** Was es gibt — auch wenn es gerade aus ist. */
export function onlineStatus(aktiv: boolean): OnlineStatus {
  return {
    aktiv,
    hinweis: aktiv
      ? 'Online-Dienste sind eingeschaltet. Yapaia fragt sie nur ab, wenn Sie es anstoßen oder während einer Fahrt danach verlangt wird; die Navigation selbst arbeitet weiterhin offline.'
      : 'Online-Dienste sind ausgeschaltet. Yapaia verlässt damit nie das Haus. Einschalten in der Add-on-Konfiguration unter „online" → „enabled".',
    dienste: [
      {
        name: 'Autobahn GmbH',
        beschreibung:
          'Baustellen, Sperrungen, Warnungen, Rastanlagen und LKW-Parkplätze auf Bundesautobahnen.',
        schluessel_noetig: false,
      },
      {
        name: 'OpenStreetMap, Wikipedia, Wikimedia Commons',
        beschreibung:
          'Infos zu einem angetippten Ort: Öffnungszeiten, Website, Telefon, Wikipedia-Auszug und Bilder. Hinaus gehen nur Koordinaten und Name dieses Ortes.',
        schluessel_noetig: false,
      },
      {
        name: 'Tankerkönig',
        beschreibung:
          'Aktuelle Spritpreise deutscher Tankstellen in der Tankstellensuche. Braucht einen kostenlosen Schlüssel von tankerkoenig.de; hinaus geht nur die auf etwa 5 km gerundete Gegend der gefundenen Tankstellen.',
        schluessel_noetig: true,
      },
    ],
  };
}

function fehler(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export interface OnlinePluginOptions {
  /** Injizierbar für Tests — sonst die echte Umgebung. */
  env?: NodeJS.ProcessEnv;
  diagnoseDeps?: DiagnoseDeps;
  verkehrDeps?: VerkehrDeps;
  ortDeps?: OrtDeps;
  /** Injizierbar, damit ein Test die Uhr stellen kann. In Produktion gehört
   *  er zur Plugin-Instanz und lebt so lange wie der Kern. */
  verkehrCache?: VerkehrCache;
  tankenDeps?: TankenDeps;
}

interface VerkehrBody {
  /** Die Autobahnen, die zählen — die App leitet sie aus der Route ab. */
  strassen?: unknown;
}

interface VerkehrReply {
  data: VerkehrBefund & { urteil: string };
}

interface DiagnoseBody {
  /** Welche Autobahn geprüft wird. Vorgabe `A61`. */
  strasse?: string;
}

interface DiagnoseReply {
  data: { urteil: string; zeilen: DiagnoseZeile[] };
}

/** Nur das, was in einer Autobahn-Kennung vorkommt. */
const STRASSE_MUSTER = /^[A-Za-z]{1,2}[0-9]{1,4}$/;

export const onlinePlugin: FastifyPluginAsync<OnlinePluginOptions> = async (fastify, opts) => {
  const env = opts.env ?? process.env;

  // GET /api/v1/tanken/preise?lat=&lon=&rad= -- Spritpreise der Gegend.
  // Ein GET, obwohl er nach außen fragt: die Oberfläche ruft ihn NUR, wenn
  // eine Tankstellensuche Treffer hat, und ohne Schalter UND Schlüssel tut er
  // nichts (409) -- dann zeigt die Oberfläche einfach keine Preise.
  const tanken = new Map<string, Tankerkoenig>();
  fastify.get<{
    Querystring: { lat?: string; lon?: string; rad?: string };
    Reply: { data: Preisabfrage } | ApiError;
  }>('/api/v1/tanken/preise', async (request, reply) => {
    const key = tankerkoenigSchluessel(env);
    if (!onlineEingeschaltet(env) || !key) {
      return reply
        .code(409)
        .send(
          fehler(
            'TANKERKOENIG_AUS',
            'Spritpreise brauchen eingeschaltete Online-Dienste und einen Tankerkönig-Schlüssel ' +
              '(Add-on-Konfiguration → „online").',
          ),
        );
    }
    const lat = Number(request.query.lat);
    const lon = Number(request.query.lon);
    const rad = Number(request.query.rad ?? 10);
    if (
      request.query.lat === undefined ||
      request.query.lon === undefined ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      !Number.isFinite(rad)
    ) {
      return reply.code(400).send(fehler('VALIDATION_ERROR', 'lat und lon (und rad) als Zahlen angeben.'));
    }
    let client = tanken.get(key);
    if (!client) {
      client = new Tankerkoenig(key, opts.tankenDeps);
      tanken.set(key, client);
    }
    try {
      return reply.code(200).send({ data: await client.umkreis(lat, lon, rad) });
    } catch (err) {
      const e = err instanceof TankerkoenigFehler ? err : new TankerkoenigFehler(String(err), 'NETZ');
      request.log.warn({ code: e.code }, e.message);
      return reply
        .code(502)
        .send(fehler(e.code === 'SCHLUESSEL' ? 'TANKERKOENIG_SCHLUESSEL' : 'TANKERKOENIG_FEHLER', e.message));
    }
  });

  fastify.get<{ Reply: { data: OnlineStatus } }>('/api/v1/online/status', async (_req, reply) => {
    return reply.code(200).send({ data: onlineStatus(onlineEingeschaltet(env)) });
  });

  fastify.post<{ Body: DiagnoseBody; Reply: DiagnoseReply | ApiError }>(
    '/api/v1/online/diagnose',
    async (request, reply) => {
      if (!onlineEingeschaltet(env)) {
        return reply
          .code(409)
          .send(
            fehler(
              'ONLINE_DISABLED',
              'Die Online-Dienste sind ausgeschaltet. Einschalten in der Add-on-Konfiguration ' +
                'unter „online" → „enabled"; danach verlässt eine Anfrage das Haus.',
            ),
          );
      }

      const strasse = (request.body?.strasse ?? 'A61').trim().toUpperCase();
      // Die Kennung landet in einer URL. Sie wird zwar kodiert, aber ein
      // freier Text hier waere trotzdem eine Einladung -- und „A61" ist ein
      // eng umrissenes Format.
      if (!STRASSE_MUSTER.test(strasse)) {
        return reply
          .code(400)
          .send(
            fehler(
              'INVALID_ROAD',
              `„${strasse}" ist keine Autobahnkennung. Erwartet wird etwas wie „A61" oder „A3".`,
            ),
          );
      }

      const zeilen = await diagnoseAutobahn(strasse, opts.diagnoseDeps);
      fastify.log.info(
        { strasse, zeilen: zeilen.length, urteil: gesamturteil(zeilen) },
        'online: Diagnose gelaufen',
      );
      return reply.code(200).send({ data: { urteil: gesamturteil(zeilen), zeilen } });
    },
  );

  // POST /api/v1/online/verkehr -- Baustellen und Sperrungen für die
  // genannten Autobahnen.
  //
  // ─── WARUM AUCH DAS EIN POST IST ────────────────────────────────────────
  // Aus demselben Grund wie die Diagnose: der Aufruf verlässt das Haus. Ein
  // GET sieht harmlos aus — Browser holen ihn vor, Erreichbarkeitsprüfungen
  // fragen ihn ab, ein Dashboard lädt ihn im Hintergrund nach. Nichts davon
  // soll ungefragt eine Anfrage an einen fremden Server auslösen. Für einen
  // reinen Lesevorgang ist POST ungewöhnlich; die Regel „Yapaia telefoniert
  // nur auf Ansage" wiegt hier schwerer als die Form.
  //
  // ─── UND WARUM ER SICH NICHT SELBST DIE STRASSEN SUCHT ──────────────────
  // Welche Autobahnen zählen, weiß nur, wer die Route kennt — das ist die
  // App. Der Kern hier zu raten hiesse, entweder zu viel zu fragen (eine
  // Salve nach draußen) oder zu wenig (eine Lücke, die wie Ruhe aussieht).
  //
  // Der Zwischenspeicher gehört zur PLUGIN-Instanz und nicht in die
  // Anfrage: sonst wäre er bei jedem Aufruf leer und damit wirkungslos.
  const verkehrCache = opts.verkehrCache ?? new VerkehrCache();

  fastify.post<{ Body: VerkehrBody; Reply: VerkehrReply | ApiError }>(
    '/api/v1/online/verkehr',
    async (request, reply) => {
      if (!onlineEingeschaltet(env)) {
        return reply
          .code(409)
          .send(
            fehler(
              'ONLINE_DISABLED',
              'Die Online-Dienste sind ausgeschaltet. Einschalten in der Add-on-Konfiguration ' +
                'unter „online" → „enabled"; danach verlässt eine Anfrage das Haus.',
            ),
          );
      }

      const roh = Array.isArray(request.body?.strassen) ? request.body.strassen : [];
      const befund = await holeVerkehr(
        roh.filter((s): s is string => typeof s === 'string'),
        { ...opts.verkehrDeps, cache: verkehrCache },
      );

      // Die Einschränkungen gehören ins Protokoll, nicht nur in die Antwort:
      // wer später einem Fehler nachgeht, sieht hier, ob die Daten damals
      // überhaupt vollständig waren.
      fastify.log.info(
        {
          strassen: befund.strassen,
          meldungen: befund.meldungen.length,
          ohne_ort: befund.ohne_ort,
        },
        `online: Verkehr abgefragt — ${verkehrUrteil(befund)}`,
      );
      return reply.code(200).send({ data: { ...befund, urteil: verkehrUrteil(befund) } });
    },
  );

  // POST /api/v1/online/ort -- OpenStreetMap, Wikipedia und Bilder zu einem
  // Ort (online/ort.ts). POST aus demselben Grund wie oben: die Anfrage
  // verlässt das Haus, und das nur, wenn jemand einen Ort angetippt hat.
  //
  // Zwischengespeichert für einen Tag: wer denselben Stellplatz zweimal
  // antippt, soll nicht zweimal drei Dienste anfragen.
  const ortCache = new Map<string, { bis: number; info: OrtInfo }>();
  fastify.post<{ Body: { lat?: unknown; lon?: unknown; name?: unknown }; Reply: { data: OrtInfo } | ApiError }>(
    '/api/v1/online/ort',
    async (request, reply) => {
      if (!onlineEingeschaltet(env)) {
        return reply
          .code(409)
          .send(
            fehler(
              'ONLINE_DISABLED',
              'Die Online-Dienste sind ausgeschaltet. Einschalten in der Add-on-Konfiguration ' +
                'unter „online" → „enabled"; danach verlässt eine Anfrage das Haus.',
            ),
          );
      }
      const { lat, lon, name } = request.body ?? {};
      if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) ||
          Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return reply.code(400).send(fehler('INVALID_POSITION', 'lat/lon fehlen oder liegen außerhalb der Erde.'));
      }
      const ortsname = typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : undefined;
      const schluessel = `${lat.toFixed(4)}|${lon.toFixed(4)}|${ortsname ?? ''}`;
      const jetzt = Date.now();
      const gemerkt = ortCache.get(schluessel);
      if (gemerkt && gemerkt.bis > jetzt) return reply.code(200).send({ data: gemerkt.info });

      const info = await holeOrtInfo({ lat, lon, name: ortsname }, opts.ortDeps);
      if (ortCache.size > 200) ortCache.delete(ortCache.keys().next().value as string);
      ortCache.set(schluessel, { bis: jetzt + 24 * 3600_000, info });
      fastify.log.info(
        { osm: info.osm !== null, wikipedia: info.wikipedia?.titel ?? null, bilder: info.bilder.length },
        'online: Ortsinfo abgefragt',
      );
      return reply.code(200).send({ data: info });
    },
  );
};
