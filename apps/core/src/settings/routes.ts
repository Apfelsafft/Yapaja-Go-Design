/**
 * Fastify routes for the general-purpose settings store (E07-T1).
 * Prefix: /api/v1.
 *
 *  - GET   /settings       -> `{ data: Record<string, unknown> }`, all keys
 *  - GET   /settings/:key  -> `{ data: unknown }`, 404 if the key was never set
 *  - PATCH /settings       -> body: `Record<string, unknown>` (partial), each
 *                              key is upserted wholesale; returns the FULL
 *                              merged settings map, `{ data: ... }`
 */
import type { FastifyPluginAsync } from 'fastify';
import type { ApiError } from '@yapaia/shared';
import { SettingsService } from './service.js';

interface SettingsKeyParams {
  key: string;
}

interface SettingsReply {
  data: Record<string, unknown>;
}

interface SettingsValueReply {
  data: unknown;
}

function createErrorResponse(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export interface SettingsPluginOptions {
  /** Injectable for tests; defaults to a fresh `SettingsService`. */
  service?: SettingsService;
  /** Vorgaben aus der Add-on-Konfiguration -- siehe `GET /settings/defaults`. */
  defaults?: {
    /** `display.theme` der Add-on-Option; leer/fehlend = keine Vorgabe. */
    themeMode?: string;
  };
}

export const settingsPlugin: FastifyPluginAsync<SettingsPluginOptions> = async (fastify, opts) => {
  const settingsService = opts.service ?? new SettingsService();

  fastify.get<{ Reply: SettingsReply }>('/settings', async (_request, reply) => {
    reply.code(200).send({ data: settingsService.getAll() });
  });

  /**
   * Die VORGABEN aus der Add-on-Konfiguration.
   *
   * ─── WARUM EIN EIGENER WEG UND NICHT DER EINSTELLUNGS-SPEICHER ────────────
   * Eine Vorgabe ist keine Einstellung. Schriebe das Add-on sie beim Start in
   * den Speicher, waere sie von der Wahl des Betreibers nicht mehr zu
   * unterscheiden -- und ein spaeteres Aendern der Option bliebe wirkungslos,
   * weil der Schluessel ja schon belegt ist. Genau diese Sorte stiller
   * Wirkungslosigkeit hat in diesem Projekt schon mehrfach Zeit gekostet.
   *
   * Hier bleiben beide getrennt: der Speicher haelt, was der Betreiber
   * GEWAEHLT hat, dieser Weg nennt, was gaelte, wenn er nichts gewaehlt hat.
   * Die Rangfolge bildet der Aufrufer (`apps/web/src/theme/themeClient.ts`).
   *
   * `null` heisst „keine Vorgabe" -- etwa im Standalone-Betrieb ohne Add-on.
   */
  fastify.get('/settings/defaults', async (_request, reply) => {
    const wert = (opts.defaults?.themeMode ?? '').trim();
    reply.code(200).send({ data: { theme: wert.length > 0 ? { mode: wert } : null } });
  });

  fastify.get<{ Params: SettingsKeyParams; Reply: SettingsValueReply | ApiError }>(
    '/settings/:key',
    async (request, reply) => {
      const value = settingsService.get(request.params.key);
      if (value === undefined) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Setting "${request.params.key}" not found`));
      }
      reply.code(200).send({ data: value });
    },
  );

  fastify.patch<{ Body: Record<string, unknown>; Reply: SettingsReply | ApiError }>(
    '/settings',
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply
          .code(400)
          .send(createErrorResponse('VALIDATION_ERROR', 'Request body must be a JSON object of key/value pairs'));
      }
      const data = settingsService.patch(body);
      reply.code(200).send({ data });
    },
  );
};
