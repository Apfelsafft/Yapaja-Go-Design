import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

interface HealthResponse {
  status: string;
  version: string;
  services: Record<string, unknown>;
}

describe('Health Endpoint', () => {
  it('should return 200 with correct schema', async () => {
    const fastify = Fastify();

    fastify.get<{ Reply: HealthResponse }>('/api/v1/health', async () => {
      return {
        status: 'ok',
        version: '0.0.1',
        services: {},
      };
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);

    const json = response.json() as HealthResponse;
    expect(json).toHaveProperty('status');
    expect(json.status).toBe('ok');
    expect(json).toHaveProperty('version');
    expect(typeof json.version).toBe('string');
    expect(json).toHaveProperty('services');
    expect(typeof json.services).toBe('object');

    await fastify.close();
  });
});
