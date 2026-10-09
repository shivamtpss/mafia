import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { RoomsModule } from './rooms/rooms.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    RoomsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
