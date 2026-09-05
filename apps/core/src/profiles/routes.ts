/**
 * Fastify routes for vehicle profile management
 * Prefix: /api/v1/profiles
 */

import type { FastifyPluginAsync } from 'fastify';
import type { VehicleProfile, ApiError } from '@yapaja/shared';
import { validateVehicleProfile, getValidationErrorsVehicleProfile } from '@yapaja/shared';
import { ProfileService } from './service.js';

interface RouteParams {
  id: string;
}

interface ProfileListReply {
  data: VehicleProfile[];
}

interface ProfileDetailReply {
  data: VehicleProfile;
}

interface ValidationErrorDetails extends Record<string, unknown> {
  fields: Record<string, string>;
}

// Helper to create error response
function createErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

// Helper to validate profile fields and return detailed errors
function validateProfileInput(
  data: unknown,
): { valid: boolean; errors?: ValidationErrorDetails } {
  if (!validateVehicleProfile(data)) {
    const errors = getValidationErrorsVehicleProfile(data);
    const fieldErrors: Record<string, string> = {};
    for (const error of errors) {
      const match = error.match(/VehicleProfile\[([^\]]+)\]:\s*(.*?)(?:\s*\(|$)/);
      if (match && match[1] && match[2]) {
        const field = match[1];
        const msg = match[2];
        fieldErrors[field] = msg;
      }
    }
    return { valid: false, errors: { fields: fieldErrors } };
  }
  return { valid: true };
}

export interface ProfileRoutesOptions {
  /** Test/production seam: inject a pre-built service (wins over constructing
   *  a fresh one) -- E06-T3 needs the SAME instance `buildServer` wires
   *  `onProfileChanged` onto (publishing `event/profile_changed`), otherwise
   *  activations made through these HTTP routes would never reach the bus. */
  service?: ProfileService;
}

export const profilesPlugin: FastifyPluginAsync<ProfileRoutesOptions> = async (fastify, opts) => {
  const service = opts.service ?? new ProfileService();
  await service.init();

  // GET /api/v1/profiles - List all profiles
  fastify.get<{ Reply: ProfileListReply }>('/profiles', async (_request, reply) => {
    const profiles = service.getAll();
    reply.code(200).send({ data: profiles });
  });

  // POST /api/v1/profiles - Create new profile
  fastify.post<{ Body: Omit<VehicleProfile, 'id' | 'is_active'>; Reply: ProfileDetailReply | ApiError }>(
    '/profiles',
    async (request, reply) => {
      // Validate input (construct a temp profile for validation, then validate partial)
      const input = request.body;

      // Validate required fields for creation
      if (!input || typeof input !== 'object') {
        return reply
          .code(400)
          .send(createErrorResponse('VALIDATION_ERROR', 'Invalid request body'));
      }

      // Type assertion for easier checking
      const tempProfile = {
        ...(input as Record<string, unknown>),
        id: 'temp-id',
        is_active: false,
      };

      const validation = validateProfileInput(tempProfile);
      if (!validation.valid) {
        return reply
          .code(400)
          .send(createErrorResponse('VALIDATION_ERROR', 'Profile validation failed', validation.errors));
      }

      try {
        const profile = service.create(input as Omit<VehicleProfile, 'id' | 'is_active'>);
        reply.code(201).send({ data: profile });
      } catch (err) {
        return reply
          .code(400)
          .send(createErrorResponse('CREATE_ERROR', (err as Error).message));
      }
    },
  );

  // GET /api/v1/profiles/:id - Get profile by ID
  fastify.get<{ Params: RouteParams; Reply: ProfileDetailReply | ApiError }>(
    '/profiles/:id',
    async (request, reply) => {
      const { id } = request.params;
      const profile = service.getById(id);

      if (!profile) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Profile ${id} not found`));
      }

      reply.code(200).send({ data: profile });
    },
  );

  // PUT /api/v1/profiles/:id - Update profile
  fastify.put<{ Params: RouteParams; Body: Partial<VehicleProfile>; Reply: ProfileDetailReply | ApiError }>(
    '/profiles/:id',
    async (request, reply) => {
      const { id } = request.params;
      const input = request.body;

      // Ignore is_active in the input
      const { is_active: _ignored, id: _id, ...updateData } = input as Record<string, unknown>;

      try {
        const profile = service.update(id, updateData as Partial<Omit<VehicleProfile, 'id' | 'is_active'>>);
        reply.code(200).send({ data: profile });
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes('not found')) {
          return reply
            .code(404)
            .send(createErrorResponse('NOT_FOUND', message));
        }
        return reply
          .code(400)
          .send(createErrorResponse('UPDATE_ERROR', message));
      }
    },
  );

  // DELETE /api/v1/profiles/:id - Delete profile
  // Bodiless 204 on success; fastify 5 requires an explicit `send()` argument,
  // so `undefined` is part of the reply type (see `favorites/routes.ts`).
  fastify.delete<{ Params: RouteParams; Reply: ApiError | undefined }>(
    '/profiles/:id',
    async (request, reply) => {
      const { id } = request.params;

      try {
        service.delete(id);
        reply.code(204).send(undefined);
      } catch (err) {
        const error = err as Error & { code?: string };
        if (error.code === 'ACTIVE_PROFILE_UNDELETABLE') {
          return reply
            .code(409)
            .send(createErrorResponse('ACTIVE_PROFILE_UNDELETABLE', 'Cannot delete the active profile'));
        }
        if (error.message.includes('not found')) {
          return reply
            .code(404)
            .send(createErrorResponse('NOT_FOUND', error.message));
        }
        return reply
          .code(400)
          .send(createErrorResponse('DELETE_ERROR', error.message));
      }
    },
  );

  // PUT /api/v1/profiles/:id/activate - Activate profile
  fastify.put<{ Params: RouteParams; Reply: ProfileDetailReply | ApiError }>(
    '/profiles/:id/activate',
    async (request, reply) => {
      const { id } = request.params;

      try {
        const profile = service.activate(id);
        reply.code(200).send({ data: profile });
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes('not found')) {
          return reply
            .code(404)
            .send(createErrorResponse('NOT_FOUND', message));
        }
        return reply
          .code(400)
          .send(createErrorResponse('ACTIVATE_ERROR', message));
      }
    },
  );

  // PUT /api/v1/profiles/:id/confirm_dimensions
  //
  // Die Antwort auf „Stimmen diese Masse?" in der Oberflaeche, wenn nichts
  // geaendert werden muss. Bewusst eine EIGENE Route und kein Feld in `PUT
  // /profiles/:id`: „ein Mensch hat die Masse bestaetigt" darf nur aus einer
  // Handlung entstehen, nie daraus, dass ein Aufrufer ein Feld mitschickt --
  // sonst koennte ein Formular, das einfach das ganze Profil zurueckschreibt,
  // eine Sicherheitsangabe erzeugen, die niemand gegeben hat.
  fastify.put<{ Params: RouteParams; Reply: ProfileDetailReply | ApiError }>(
    '/profiles/:id/confirm_dimensions',
    async (request, reply) => {
      const { id } = request.params;

      try {
        const profile = service.confirmDimensions(id);
        reply.code(200).send({ data: profile });
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes('not found')) {
          return reply.code(404).send(createErrorResponse('NOT_FOUND', message));
        }
        return reply.code(400).send(createErrorResponse('CONFIRM_ERROR', message));
      }
    },
  );
};
