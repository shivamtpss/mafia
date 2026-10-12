import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { AiModule } from './ai/ai.module';
import { RoomsModule } from './rooms/rooms.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The server runs with cwd=apps/server but .env lives at the monorepo
      // root. Load both so env works no matter where the process starts.
      envFilePath: [
        '.env',
        join(__dirname, '..', '.env'),
        join(__dirname, '..', '..', '..', '.env'),
      ],
    }),
    CommonModule,
    AiModule,
    RoomsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
