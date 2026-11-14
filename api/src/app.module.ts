import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController, AuthGuard } from './auth.js';
import { ENTITIES } from './entities.js';
import { MetaController, TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';
import { TriageService } from './triage.service.js';

// The Angular build, copied next to the API in the Docker image.
const WEB_DIST = process.env.WEB_DIST ?? join(process.cwd(), '..', 'web', 'dist', 'web', 'browser');

const database = process.env.DATABASE_URL
  ? TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      entities: ENTITIES,
      // Three tables and a demo: sync is fine here. A real deployment would use migrations.
      synchronize: true,
    })
  : TypeOrmModule.forRoot({ type: 'sqljs', entities: ENTITIES, synchronize: true });

const staticSite: DynamicModule[] = existsSync(WEB_DIST)
  ? [ServeStaticModule.forRoot({ rootPath: WEB_DIST, exclude: ['/api/{*path}'] })]
  : [];

@Module({
  imports: [
    database,
    TypeOrmModule.forFeature(ENTITIES),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
      signOptions: { expiresIn: '8h' },
    }),
    ...staticSite,
  ],
  controllers: [AuthController, TicketsController, MetaController],
  providers: [TicketsService, TriageService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
