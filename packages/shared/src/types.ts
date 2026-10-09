/**
 * Core domain types for AI Mafia.
 * These are shared between the NestJS server and the Next.js client to keep a
 * single source of truth for the Socket.IO contract and game model.
 */

/** Game roles. */
export enum Role {
  Townsperson = 'TOWNSPERSON',
  Detective = 'DETECTIVE',
  Doctor = 'DOCTOR',
  Mafia = 'MAFIA',
}

/** Which team a role belongs to. */
export enum Team {
  Town = 'TOWN',
  Mafia = 'MAFIA',
}

export const ROLE_TEAM: Record<Role, Team> = {
  [Role.Townsperson]: Team.Town,
  [Role.Detective]: Team.Town,
  [Role.Doctor]: Team.Town,
  [Role.Mafia]: Team.Mafia,
};

/** Lifecycle of a room/game. */
export enum GamePhase {
  Lobby = 'LOBBY',
  RoleReveal = 'ROLE_REVEAL',
  Night = 'NIGHT',
  Resolution = 'RESOLUTION',
  Day = 'DAY',
  Voting = 'VOTING',
  Elimination = 'ELIMINATION',
  GameOver = 'GAME_OVER',
}

/** Type of player seat. */
export enum PlayerKind {
  Human = 'HUMAN',
  Ai = 'AI',
}

export enum PlayerStatus {
  Alive = 'ALIVE',
  Dead = 'DEAD',
}

export enum ConnectionStatus {
  Connected = 'CONNECTED',
  Disconnected = 'DISCONNECTED',
}

/**
 * Public view of a player: safe to broadcast to everyone in the room.
 * Note: `role` and `team` are intentionally absent here. Private role info is
 * delivered only to the owning player via a separate `role:assigned` event.
 */
export interface PublicPlayer {
  id: string;
  displayName: string;
  avatar: string;
  kind: PlayerKind;
  isHost: boolean;
  isReady: boolean;
  status: PlayerStatus;
  connection: ConnectionStatus;
  /** Join order, used for stable seat ordering in the UI. */
  seat: number;
}

/** Private role info sent only to the owning human player. */
export interface PrivateRoleInfo {
  playerId: string;
  role: Role;
  team: Team;
  /** For Mafia: ids of fellow mafia. Empty/omitted for town roles. */
  allies?: string[];
}

export interface RoomSettings {
  /** Minimum humans needed to start (host may fill rest with AI later). */
  minPlayers: number;
  maxPlayers: number;
  /** Phase durations in seconds. */
  phaseDurations: {
    roleReveal: number;
    night: number;
    day: number;
    voting: number;
    elimination: number;
  };
  /** Whether a revealed eliminated player's role is shown publicly. */
  revealRoleOnElimination: boolean;
  /** Allow changing a vote before the voting deadline. */
  allowVoteChange: boolean;
  /** Theme id for narration (Phase 4+). */
  themeId?: string;
}

/** Public room/lobby snapshot broadcast to everyone in the room. */
export interface PublicRoomState {
  code: string;
  phase: GamePhase;
  hostId: string;
  settings: RoomSettings;
  players: PublicPlayer[];
  /** Round counter (0 in lobby, 1+ once playing). */
  round: number;
  /** Server epoch millis when the current phase ends (if timed). */
  phaseEndsAt: number | null;
  createdAt: number;
}
