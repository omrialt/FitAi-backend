import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { Application, RequestHandler } from 'express';

const DOCS_PATH = 'docs';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Get the Express instance behind Nest
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

  // Middlewares
  expressApp.use(morgan('dev'));
  expressApp.use((req, res, next) =>
    req.path.startsWith(`/${DOCS_PATH}`)
      ? docsHelmet(req, res, next)
      : strictHelmet(req, res, next),
  );
  expressApp.use(compression());
  expressApp.use(cookieParser());

  // Global validation pipe with custom error handling
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

  // CORS
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

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });
  logger.log(`CORS allowed origins: ${corsOrigins.join(', ')}`);

  // API docs — off in production so the schema isn't publicly browsable
  const docsEnabled = process.env.NODE_ENV !== 'production';
  if (docsEnabled) {
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

  const port = app.get(ConfigService).get<number>('port') ?? 3000;
  await app.listen(port);

  logger.log(`🚀 Server running on http://localhost:${port}`);
  if (docsEnabled) {
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
