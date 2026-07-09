import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import pino from 'pino';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface HealthResponse {
  status: string;
  version: string;
  services: Record<string, unknown>;
}

async function readPackageVersion(): Promise<string> {
  try {
    const packagePath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || '8080', 10);
  const host = process.env.HOST || '0.0.0.0';

  // Create structured logger using pino
  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
  });

  const fastify = Fastify({
    logger: true,
  });

  const version = await readPackageVersion();

  fastify.get<{ Reply: HealthResponse }>('/api/v1/health', async (_request, _reply) => {
    return {
      status: 'ok',
      version,
      services: {},
    };
  });

  // Register static file serving for the web application
  const publicDir = join(__dirname, '../public');
  if (existsSync(publicDir)) {
    await fastify.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
    });

    // Add a catch-all route for SPA fallback to index.html for non-API routes
    fastify.setNotFoundHandler(async (_request, reply) => {
      if (!_request.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'Not Found' });
    });
  }

  const gracefulShutdown = async (): Promise<void> => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  try {
    await fastify.listen({ port, host });
    logger.info(`Server running at http://${host}:${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
