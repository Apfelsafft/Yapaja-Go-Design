/**
 * REST surface for the add-on SERVICE runtime (E09-T3, docs/05 §1B/§2).
 * Prefix: `/api/v1`.
 *
 *  Operator-facing (ordinary Core-token auth; an add-on token is refused by
 *  the scope matrix's default-deny, since these paths are not in the table):
 *   - POST /addons/:id/token   -> mint/ROTATE the add-on's scoped token and
 *     return it ONCE. This is how a `runtime: external` add-on (own container,
 *     docs/05 §7) gets its credential: the Core starts no process for it, the
 *     operator copies the token into the container's config.
 *   - GET  /addons/:id/service -> process + watchdog status (running, pid,
 *     restarts, throttled, crashes, auto-disable notice). Also readable BY the
 *     add-on itself for its own id (`ownAddonOnly` in the matrix).
 *
 *  Add-on-facing (scoped add-on token, own namespace only):
 *   - POST /addons/:id/events        -> `events.publish`; the topic is forced
 *     into `addon/{id}/*` server-side (docs/05 §2).
 *   - POST /addons/:id/notifications -> `ha.notify`; hands the message to the
 *     HA output channel via `event/addon_notify`.
 */

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { Buffer } from 'node:buffer';
import type { ApiError } from '@yapaja/shared';
import type { EventBus } from '../bus/index.js';
import { AddonRepository } from './repository.js';
import type { AddonServiceHost } from './service-host.js';
import { normalizeAddonEventTopic } from './scopeMatrix.js';
import { securityEventLog } from '../security/securityEvents.js';

function err(code: string, message: string): ApiError {
  return { error: { code, message } };
}

interface AddonIdParams {
  id: string;
}

export interface AddonServicePluginOptions {
  host: AddonServiceHost;
  bus: EventBus;
  repository?: AddonRepository;
  /** Cap on a published payload so an add-on can't flood the bus/WS clients. */
  maxEventPayloadBytes?: number;
}

export const DEFAULT_MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;

export const addonServicePlugin: FastifyPluginAsync<AddonServicePluginOptions> = async (fastify, opts) => {
  const repository = opts.repository ?? new AddonRepository();
  const { host, bus } = opts;
  const maxPayloadBytes = opts.maxEventPayloadBytes ?? DEFAULT_MAX_EVENT_PAYLOAD_BYTES;

  const requireInstalled = (id: string, reply: FastifyReply): boolean => {
    if (!repository.getById(id)) {
      reply.code(404).send(err('NOT_FOUND', `No add-on installed with id "${id}"`));
      return false;
    }
    return true;
  };

  // --- operator: mint/rotate the scoped token -------------------------------
  fastify.post<{ Params: AddonIdParams }>('/addons/:id/token', async (request, reply) => {
    const { id } = request.params;
    if (!requireInstalled(id, reply)) return;
    const token = host.issueToken(id);
    if (!token) {
      reply
        .code(409)
        .send(err('ADDON_DISABLED', `Add-on "${id}" is disabled -- enable it before issuing a token`));
      return;
    }
    // The ONLY response that ever carries the raw token. Never logged.
    reply.code(200).send({ data: { addon_id: id, token } });
  });

  // --- service/watchdog status ---------------------------------------------
  fastify.get<{ Params: AddonIdParams }>('/addons/:id/service', async (request, reply) => {
    const status = host.getStatus(request.params.id);
    if (!status) {
      reply.code(404).send(err('NOT_FOUND', `No add-on installed with id "${request.params.id}"`));
      return;
    }
    reply.code(200).send({ data: status });
  });

  // --- events.publish (addon/{id}/* only) -----------------------------------
  fastify.post<{ Params: AddonIdParams; Body: { topic?: unknown; payload?: unknown } }>(
    '/addons/:id/events',
    async (request, reply) => {
      const { id } = request.params;
      if (!requireInstalled(id, reply)) return;
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.topic !== 'string') {
        reply.code(400).send(err('VALIDATION_ERROR', 'Body must be a JSON object with a string "topic"'));
        return;
      }
      // Namespace enforcement: the topic is REWRITTEN into `addon/{id}/...`
      // (or rejected). An add-on can never publish onto `nav/state`,
      // `pos/update` or another add-on's namespace.
      const topic = normalizeAddonEventTopic(id, body.topic);
      if (!topic) {
        request.log.warn({ addon_id: id, topic: body.topic }, 'add-on event publish refused: topic outside addon/{id}/*');
        // E09-T6: same refusal, recorded as a `security` event.
        securityEventLog.record(
          'events.foreign_topic',
          id,
          `refused events.publish to "${String(body.topic).slice(0, 120)}" (outside addon/${id}/*)`,
        );
        reply
          .code(403)
          .send(err('TOPIC_NOT_ALLOWED', `Topic "${body.topic}" is outside this add-on's addon/${id}/* namespace`));
        return;
      }
      const payload = body.payload ?? null;
      const size = Buffer.byteLength(JSON.stringify(payload ?? null), 'utf8');
      if (size > maxPayloadBytes) {
        reply
          .code(413)
          .send(err('PAYLOAD_TOO_LARGE', `Event payload of ${size} bytes exceeds the ${maxPayloadBytes}-byte cap`));
        return;
      }
      bus.publish(topic, payload);
      reply.code(202).send({ data: { topic } });
    },
  );

  // --- ha.notify ------------------------------------------------------------
  fastify.post<{ Params: AddonIdParams; Body: { message?: unknown; title?: unknown } }>(
    '/addons/:id/notifications',
    async (request, reply) => {
      const { id } = request.params;
      const record = repository.getById(id);
      if (!record) {
        reply.code(404).send(err('NOT_FOUND', `No add-on installed with id "${id}"`));
        return;
      }
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.message !== 'string' || body.message.trim() === '') {
        reply.code(400).send(err('VALIDATION_ERROR', 'Body must be a JSON object with a non-empty string "message"'));
        return;
      }
      // The add-on NAME is always used as the notification title prefix, so a
      // notification can never impersonate the Core or another add-on.
      bus.publish('event/addon_notify', {
        addon_id: id,
        addon_name: record.name,
        title: typeof body.title === 'string' && body.title.trim() !== '' ? body.title.slice(0, 120) : null,
        message: body.message.slice(0, 1000),
      });
      reply.code(202).send({ data: { delivered: true } });
    },
  );
};
