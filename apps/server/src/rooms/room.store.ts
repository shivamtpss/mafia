import { Injectable } from '@nestjs/common';
import { RoomEntity } from './room.entity';

/**
 * In-memory room store. Rooms are ephemeral gameplay state, so they live here
 * (single instance) for Phase 1. The interface is intentionally small so a
 * Redis-backed implementation can replace it for multi-instance scaling without
 * touching callers.
 */
@Injectable()
export class RoomStore {
  private readonly rooms = new Map<string, RoomEntity>();
  /** sessionId -> roomCode, so a reconnecting socket can find its room. */
  private readonly sessionIndex = new Map<string, string>();

  get(code: string): RoomEntity | undefined {
    return this.rooms.get(code);
  }

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  set(room: RoomEntity): void {
    this.rooms.set(room.code, room);
  }

  delete(code: string): void {
    const room = this.rooms.get(code);
    if (room) {
      for (const player of room.players.values()) {
        if (this.sessionIndex.get(player.sessionId) === code) {
          this.sessionIndex.delete(player.sessionId);
        }
      }
    }
    this.rooms.delete(code);
  }

  all(): RoomEntity[] {
    return [...this.rooms.values()];
  }

  count(): number {
    return this.rooms.size;
  }

  indexSession(sessionId: string, code: string): void {
    this.sessionIndex.set(sessionId, code);
  }

  unindexSession(sessionId: string): void {
    this.sessionIndex.delete(sessionId);
  }

  findRoomBySession(sessionId: string): RoomEntity | undefined {
    const code = this.sessionIndex.get(sessionId);
    return code ? this.rooms.get(code) : undefined;
  }
}
