import {
  ConnectionStatus,
  GamePhase,
  PlayerKind,
  PlayerStatus,
  PublicPlayer,
  PublicRoomState,
  RoomSettings,
} from '@ai-mafia/shared';
import type { GameState } from '../game/game.state';

/**
 * Server-side player record. Contains fields that are NEVER sent wholesale to
 * clients (e.g. sessionId, socketId, and — in later phases — secret role).
 */
export interface ServerPlayer {
  id: string;
  sessionId: string;
  socketId: string | null;
  displayName: string;
  avatar: string;
  kind: PlayerKind;
  isHost: boolean;
  isReady: boolean;
  status: PlayerStatus;
  connection: ConnectionStatus;
  seat: number;
  joinedAt: number;
  /** Timestamp set when a player disconnects, used for reconnection grace. */
  disconnectedAt: number | null;
  /** For AI seats only: which personality drives their behavior/dialogue. */
  personalityId?: string;
}

/**
 * Authoritative room entity. The server is the single source of truth. Only the
 * projection returned by {@link toPublicRoomState} is broadcast to clients.
 */
export interface RoomEntity {
  code: string;
  phase: GamePhase;
  hostId: string;
  settings: RoomSettings;
  players: Map<string, ServerPlayer>;
  round: number;
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
  /**
   * Server-only authoritative game state while a match is in progress. Never
   * included in the public projection (toPublicRoomState ignores it).
   */
  game?: GameState;
}

export function toPublicPlayer(p: ServerPlayer): PublicPlayer {
  return {
    id: p.id,
    displayName: p.displayName,
    avatar: p.avatar,
    kind: p.kind,
    isHost: p.isHost,
    isReady: p.isReady,
    status: p.status,
    connection: p.connection,
    seat: p.seat,
  };
}

export function toPublicRoomState(room: RoomEntity): PublicRoomState {
  const players = [...room.players.values()]
    .sort((a, b) => a.seat - b.seat)
    .map(toPublicPlayer);
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    settings: room.settings,
    players,
    round: room.round,
    phaseEndsAt: room.phaseEndsAt,
    createdAt: room.createdAt,
  };
}
