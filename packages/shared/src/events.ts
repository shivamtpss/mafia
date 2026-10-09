import {
  PublicRoomState,
  PublicPlayer,
  PrivateRoleInfo,
  Role,
  Team,
  GamePhase,
} from './types';

/**
 * Socket.IO event contract for AI Mafia.
 *
 * Conventions:
 *  - client -> server events use an acknowledgement callback typed as Ack<T>.
 *  - server -> client events are fire-and-forget broadcasts or targeted emits.
 *  - Private data (roles, night actions) is NEVER broadcast to a room; it is
 *    emitted only to the owning socket.
 */

// ---------------------------------------------------------------------------
// Error handling + acknowledgements
// ---------------------------------------------------------------------------

export enum ErrorCode {
  Unknown = 'UNKNOWN',
  Validation = 'VALIDATION',
  RoomNotFound = 'ROOM_NOT_FOUND',
  RoomFull = 'ROOM_FULL',
  NameTaken = 'NAME_TAKEN',
  NotAuthorized = 'NOT_AUTHORIZED',
  NotHost = 'NOT_HOST',
  NotInRoom = 'NOT_IN_ROOM',
  AlreadyInRoom = 'ALREADY_IN_ROOM',
  WrongPhase = 'WRONG_PHASE',
  NotEnoughPlayers = 'NOT_ENOUGH_PLAYERS',
  PlayerDead = 'PLAYER_DEAD',
  ActionNotAllowed = 'ACTION_NOT_ALLOWED',
  DeadlinePassed = 'DEADLINE_PASSED',
  DuplicateAction = 'DUPLICATE_ACTION',
  RateLimited = 'RATE_LIMITED',
}

export interface SocketError {
  code: ErrorCode;
  message: string;
}

export type AckOk<T> = { ok: true; data: T };
export type AckErr = { ok: false; error: SocketError };
export type AckResult<T> = AckOk<T> | AckErr;
/** Acknowledgement callback passed as the last arg of client->server events. */
export type Ack<T> = (result: AckResult<T>) => void;

// ---------------------------------------------------------------------------
// Session identity
// ---------------------------------------------------------------------------

/**
 * A guest identity token the client stores (localStorage) and presents on
 * connect so it can reclaim its seat after a reload/disconnect. This is an
 * opaque bearer token; the server maps it to a playerId per room.
 */
export interface SessionIdentity {
  sessionId: string;
  displayName: string;
  avatar: string;
}

// ---------------------------------------------------------------------------
// Client -> Server payloads
// ---------------------------------------------------------------------------

export interface CreateRoomPayload {
  displayName: string;
  avatar: string;
}

export interface JoinRoomPayload {
  code: string;
  displayName: string;
  avatar: string;
}

export interface RejoinRoomPayload {
  code: string;
  /**
   * The session token to reclaim a seat with. The client passes it explicitly
   * (rather than relying solely on handshake auth) so rejoin works even when the
   * socket has not reconnected since the token was issued.
   */
  sessionId?: string;
}

export interface ReadyPayload {
  isReady: boolean;
}

export interface UpdateProfilePayload {
  displayName?: string;
  avatar?: string;
}

export interface ChatSendPayload {
  text: string;
}

export interface NightActionPayload {
  /** Target player id (null to pass/skip where allowed). */
  targetId: string | null;
}

export interface VoteCastPayload {
  /** Target player id, or null to abstain. */
  targetId: string | null;
}

/** Host adds AI players to fill empty seats (Phase 5; stubbed earlier). */
export interface AddAiPlayersPayload {
  count: number;
}

export interface UpdateSettingsPayload {
  settings: Partial<import('./types').RoomSettings>;
}

// ---------------------------------------------------------------------------
// Ack return data
// ---------------------------------------------------------------------------

export interface JoinedRoomData {
  /** The caller's own player id within this room. */
  selfId: string;
  /**
   * The session token the client must persist (localStorage) to reclaim this
   * seat after a reload or reconnect. Opaque bearer token.
   */
  sessionId: string;
  room: PublicRoomState;
}

// ---------------------------------------------------------------------------
// Server -> Client payloads
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  roomCode: string;
  authorId: string | null; // null = system/narrator
  authorName: string;
  text: string;
  at: number;
  system: boolean;
}

export interface PhaseChangedPayload {
  phase: GamePhase;
  round: number;
  phaseEndsAt: number | null;
  /** Optional narration/announcement line for this transition. */
  announcement?: string;
}

export interface VoteTally {
  /** targetId -> number of votes (abstain counted under key "ABSTAIN"). */
  counts: Record<string, number>;
  /** Who has voted (voterId list) without revealing choices mid-phase. */
  voted: string[];
  totalEligible: number;
}

export interface EliminationPayload {
  eliminatedId: string | null; // null = nobody (tie / protected / skip)
  reason: 'VOTE' | 'MAFIA_KILL' | 'TIE_NO_ELIMINATION' | 'NONE';
  /** Only present if settings.revealRoleOnElimination. */
  revealedRole?: Role;
}

export interface GameFinishedPayload {
  winningTeam: Team;
  /** Full role reveal is allowed only at game end. */
  roles: Array<{ playerId: string; role: Role; team: Team }>;
  summary: string;
}

/** Private investigation result for the Detective. */
export interface InvestigationResultPayload {
  round: number;
  targetId: string;
  /** Server-generated result per configured rules. */
  result: 'MAFIA' | 'NOT_MAFIA';
}

// ---------------------------------------------------------------------------
// Event name maps (typed Socket.IO)
// ---------------------------------------------------------------------------

/** Events the client sends to the server. All take an Ack callback. */
export interface ClientToServerEvents {
  'room:create': (p: CreateRoomPayload, ack: Ack<JoinedRoomData>) => void;
  'room:join': (p: JoinRoomPayload, ack: Ack<JoinedRoomData>) => void;
  'room:rejoin': (p: RejoinRoomPayload, ack: Ack<JoinedRoomData>) => void;
  'room:leave': (ack: Ack<{ left: true }>) => void;
  'player:ready': (p: ReadyPayload, ack: Ack<PublicRoomState>) => void;
  'player:update': (p: UpdateProfilePayload, ack: Ack<PublicRoomState>) => void;
  'room:settings': (p: UpdateSettingsPayload, ack: Ack<PublicRoomState>) => void;
  'room:add_ai': (p: AddAiPlayersPayload, ack: Ack<PublicRoomState>) => void;
  'game:start': (ack: Ack<PublicRoomState>) => void;
  'game:rematch': (ack: Ack<PublicRoomState>) => void;
  'chat:send': (p: ChatSendPayload, ack: Ack<{ accepted: true }>) => void;
  'night:action': (p: NightActionPayload, ack: Ack<{ accepted: true }>) => void;
  'vote:cast': (p: VoteCastPayload, ack: Ack<{ accepted: true }>) => void;
}

/** Events the server pushes to clients. */
export interface ServerToClientEvents {
  'room:updated': (room: PublicRoomState) => void;
  'player:joined': (player: PublicPlayer) => void;
  'player:left': (playerId: string) => void;
  'game:started': (room: PublicRoomState) => void;
  'role:assigned': (info: PrivateRoleInfo) => void;
  'phase:changed': (p: PhaseChangedPayload) => void;
  'chat:message': (m: ChatMessage) => void;
  'vote:updated': (t: VoteTally) => void;
  'player:eliminated': (p: EliminationPayload) => void;
  'investigation:result': (p: InvestigationResultPayload) => void;
  'game:finished': (p: GameFinishedPayload) => void;
  'error:event': (e: SocketError) => void;
}

/** Handshake auth payload sent by the client on connect. */
export interface SocketHandshakeAuth {
  sessionId?: string;
  displayName?: string;
  avatar?: string;
}
