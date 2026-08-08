import { NestFactory } from '@nestjs/core';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { Application, RequestHandler } from 'express';

import { AppModule } from './app.module';
import {
  RATE_LIMITED_PATHS,
  globalLimiter,
} from './common/middleware/rate-limit';

export const DOCS_PATH = 'docs';

/**
 * Builds and configures the Nest application WITHOUT starting a listener.
 *
 * Two entrypoints share this:
 *   - main.ts          → calls listen(), for local dev and container hosts
 *   - api/index.ts     → wraps the Express instance as a Vercel function
 *
 * Keeping the configuration here means the serverless deployment cannot drift
 * from the server deployment (CORS rules, validation, helmet policy).
 */
export async function createApp(): Promise<INestApplication> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const expressApp = app.getHttpAdapter().getInstance() as Application;

  // Swagger UI ships inline scripts and styles, which helmet's default CSP
  // blocks. Relax the policy for the docs route only, so the rest of the API
  // keeps the strict defaults.
  const strictHelmet = helmet() as RequestHandler;
  const docsHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'validator.swagger.io'],
      },
    },
  }) as RequestHandler;

  expressApp.use(morgan('dev'));
  expressApp.use((req, res, next) =>
    req.path.startsWith(`/${DOCS_PATH}`)
      ? docsHelmet(req, res, next)
      : strictHelmet(req, res, next),
  );
  expressApp.use(compression());
  expressApp.use(cookieParser());

  // Vercel and every other reverse proxy put the caller's address in
  // X-Forwarded-For. Without this the rate limiters see one proxy IP for
  // everyone and would throttle all users together. `1` (trust the nearest
  // proxy only) rather than `true`, which express-rate-limit rejects as
  // permissive because a client could then forge the header.
  expressApp.set('trust proxy', 1);

  // Order matters: the limiters must be mounted before the Nest router picks
  // the request up, and the per-endpoint limiters before the global one so a
  // blocked login does not also consume global budget.
  //
  // These key off the IP alone, so they work here — middleware registered on
  // the raw Express instance runs before Nest's body parser. The
  // forgot-password limiter keys off the submitted email and therefore needs a
  // parsed body, so it is applied as Nest middleware in AppModule instead.
  for (const { paths, limiter } of RATE_LIMITED_PATHS) {
    expressApp.use(paths, limiter);
  }
  expressApp.use(globalLimiter);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException(
          errors.map((error) => ({
            property: error.property,
            constraints: error.constraints,
          })),
        ),
      validateCustomDecorators: true,
    }),
  );

  // Allowed origins come from CORS_ORIGINS (comma-separated) so the deployed
  // frontend can be permitted without a code change; local dev ports stay
  // allowed by default. FRONTEND_URL is included since it is already the
  // canonical "where the UI lives" setting used by the OAuth and reset flows.
  const corsOrigins = Array.from(
    new Set(
      [
        ...(process.env.CORS_ORIGINS?.split(',') ?? []),
        process.env.FRONTEND_URL,
        'http://localhost:5173',
        'http://localhost:3000',
      ]
        .map((o) => o?.trim())
        .filter((o): o is string => !!o),
    ),
  );

  app.enableCors({ origin: corsOrigins, credentials: true });
  logger.log(`CORS allowed origins: ${corsOrigins.join(', ')}`);

  // API docs — off in production so the schema isn't publicly browsable
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('FitAI API')
      .setDescription(
        'Training plans, nutrition plans, physical data and progress tracking.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token issued by /auth/login',
        },
        'access-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(DOCS_PATH, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  return app;
}
