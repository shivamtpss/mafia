import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });
  const logger = new Logger('Bootstrap');

  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',');
  app.enableCors({ origin: origins, credentials: true });
  // Note: inbound payloads are validated explicitly in the shared validation
  // helpers and RoomsService guards, so no class-validator pipe is required.

  const port = Number(process.env.SERVER_PORT ?? 4000);
  await app.listen(port);
  logger.log(`AI Mafia server listening on http://localhost:${port}`);
  logger.log(`Allowed origins: ${origins.join(', ')}`);
}

bootstrap();
