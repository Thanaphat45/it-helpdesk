import { NestFactory } from '@nestjs/core';
import { StandardSchemaValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module.js';
import { seed } from './seed.js';

/** Shared by main and the e2e tests so both run the same app. */
export async function configure(app: INestApplication): Promise<void> {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  const doc = new DocumentBuilder()
    .setTitle('IT Helpdesk API')
    .setDescription('Tickets, SLA tracking and AI triage with Claude')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc));
}

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
  }
  const app = await NestFactory.create(AppModule);
  await configure(app);
  if (process.env.SEED_DEMO !== '0') await seed(app.get(DataSource));
  await app.listen(process.env.PORT ?? 3000);
}

if (!process.env.VITEST) await bootstrap();
