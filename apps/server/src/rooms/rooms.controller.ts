import { Controller, Get, Param } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { toPublicRoomState } from './room.entity';
import { PublicRoomState } from '@ai-mafia/shared';

/**
 * Read-only REST surface for rooms. Writes happen over Socket.IO (authoritative,
 * low-latency). This endpoint lets the lobby page confirm a code exists before
 * attempting to join, and returns only the public projection.
 */
@Controller('api/rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get(':code')
  getRoom(
    @Param('code') code: string,
  ): { exists: boolean; room: PublicRoomState | null } {
    const room = this.rooms.getRoom(code);
    return {
      exists: Boolean(room),
      room: room ? toPublicRoomState(room) : null,
    };
  }
}
