/* eslint-disable no-undef -- `fetch`/`Response`/`AbortController`/`setTimeout`/
 * `clearTimeout` sind Standard-Globale in Node 22 (typisiert ueber
 * @types/node); dieselbe Begruendung wie in `ha/client.ts`. */

/**
 * Die Schnittstelle zu den Online-Diensten.
 *
 *  - `GET  /api/v1/online/status`   -> was eingeschaltet ist, ohne etwas zu rufen
 *  - `POST /api/v1/online/diagnose` -> ruft die Dienste WIRKLICH und berichtet
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
};
