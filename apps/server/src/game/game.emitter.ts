import {
  ChatMessage,
  EliminationPayload,
  GameFinishedPayload,
  InvestigationResultPayload,
  PhaseChangedPayload,
  PrivateRoleInfo,
  PublicRoomState,
  VoteTally,
} from '@ai-mafia/shared';

/**
 * Transport port used by the GameService to communicate with clients. The
 * gateway implements this over Socket.IO. Keeping it an interface lets the
 * service be unit-tested with a fake emitter and no sockets.
 */
export interface GameEmitter {
  /** Broadcast the public room snapshot to everyone in the room. */
  roomUpdated(code: string, room: PublicRoomState): void;
  /** Broadcast a phase transition (with optional narration) to the room. */
  phaseChanged(code: string, payload: PhaseChangedPayload): void;
  /** Send a player their private role info (only to that player's sockets). */
  roleAssigned(playerId: string, info: PrivateRoleInfo): void;
  /** Send the detective their private investigation result. */
  investigationResult(playerId: string, payload: InvestigationResultPayload): void;
  /** Broadcast a system/narrator chat line to the room. */
  systemMessage(code: string, message: ChatMessage): void;
  /** Broadcast the current vote tally to the room. */
  voteUpdated(code: string, tally: VoteTally): void;
  /** Broadcast an elimination result to the room. */
  playerEliminated(code: string, payload: EliminationPayload): void;
  /** Broadcast game over (full role reveal allowed) to the room. */
  gameFinished(code: string, payload: GameFinishedPayload): void;
}
