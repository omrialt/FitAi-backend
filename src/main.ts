import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { createApp, DOCS_PATH } from './create-app';

/**
 * Long-running server entrypoint: local development and container hosts
 * (Render, Fly, Docker). The serverless entrypoint lives in api/index.ts and
 * shares the same createApp() configuration.
 */
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await createApp();

  const port = app.get(ConfigService).get<number>('port') ?? 3000;
  // Bind to all interfaces: container platforms route external traffic to the
  // container IP, which a localhost-only bind rejects.
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 Server running on http://localhost:${port}`);
  if (process.env.NODE_ENV !== 'production') {
    logger.log(`📚 API docs at http://localhost:${port}/${DOCS_PATH}`);
  }
}

bootstrap().catch((error) => {
  new Logger('Bootstrap').error(
    'Failed to start server',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
