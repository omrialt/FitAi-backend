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

  // ValidationPipe גלובלי לכל הבקשות
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
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
