import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { Application } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get the Express instance behind Nest
  const expressApp = app.getHttpAdapter().getInstance() as Application;

  // Middlewares
  expressApp.use(morgan('dev'));
  expressApp.use(helmet());
  expressApp.use(compression());
  expressApp.use(cookieParser());

  // Log all incoming requests with headers
  expressApp.use((req, res, next) => {
    next();
  });

  // Global validation pipe with custom error handling
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      exceptionFactory: (errors) => {
        console.log('Validation errors:', errors);
        return errors;
      },
      validateCustomDecorators: true,
    }),
  );

  // CORS
  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  });

  const port = process.env.PORT || 5000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
