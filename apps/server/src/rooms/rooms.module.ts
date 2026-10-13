import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomStore } from './room.store';
import { RoomsGateway } from './rooms.gateway';
import { RoomsController } from './rooms.controller';
import { CommonModule } from '../common/common.module';
import { GameService } from '../game/game.service';
import { AiPlayerService } from '../game/ai-player.service';

@Module({
  imports: [CommonModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomStore, RoomsGateway, GameService, AiPlayerService],
  exports: [RoomsService, RoomStore, GameService],
})
export class RoomsModule {}
