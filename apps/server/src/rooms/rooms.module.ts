import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomStore } from './room.store';
import { RoomsGateway } from './rooms.gateway';
import { RoomsController } from './rooms.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomStore, RoomsGateway],
  exports: [RoomsService, RoomStore],
})
export class RoomsModule {}
