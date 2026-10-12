import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectionStatus,
  DEFAULT_ROOM_SETTINGS,
  ErrorCode,
  GamePhase,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PlayerKind,
  PlayerStatus,
  RoomSettings,
  normalizeRoomCode,
  sanitizeAvatar,
  sanitizeDisplayName,
} from '@ai-mafia/shared';
import { RoomStore } from './room.store';
import { RoomEntity, ServerPlayer } from './room.entity';
import { RoomError } from './room.error';
import {
  generatePlayerId,
  generateRoomCode,
  generateSessionId,
} from '../common/ids';

export interface CreateRoomInput {
  sessionId?: string;
  displayName: string;
  avatar: string;
}

export interface JoinRoomInput {
  code: string;
  sessionId?: string;
  displayName: string;
  avatar: string;
}

export interface JoinOutcome {
  room: RoomEntity;
  player: ServerPlayer;
  /** The session token the caller should persist (new if none supplied). */
  sessionId: string;
  /** True when this call reclaimed an existing seat (reconnect). */
  reconnected: boolean;
}

/**
 * Authoritative lobby/room service. Contains no transport code so it can be unit
 * tested directly. The gateway is a thin adapter over these methods.
 */
@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);
  /** How long a disconnected player keeps their seat before removal (ms). */
  static readonly RECONNECT_GRACE_MS = 60_000;

  constructor(private readonly store: RoomStore) {}

  /**
   * Default room settings, allowing phase durations to be shortened via env for
   * tests / fast demos (e.g. AI_MAFIA_PHASE_DAY=2). Values are clamped by
   * updateSettings bounds when edited by a host; these raw overrides are for
   * controlled environments only.
   */
  private defaultSettings(): RoomSettings {
    const base = {
      ...DEFAULT_ROOM_SETTINGS,
      phaseDurations: { ...DEFAULT_ROOM_SETTINGS.phaseDurations },
    };
    const env = (key: string, cur: number): number => {
      const raw = process.env[key];
      if (!raw) return cur;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : cur;
    };
    const d = base.phaseDurations;
    d.roleReveal = env('AI_MAFIA_PHASE_ROLE_REVEAL', d.roleReveal);
    d.night = env('AI_MAFIA_PHASE_NIGHT', d.night);
    d.day = env('AI_MAFIA_PHASE_DAY', d.day);
    d.voting = env('AI_MAFIA_PHASE_VOTING', d.voting);
    d.elimination = env('AI_MAFIA_PHASE_ELIMINATION', d.elimination);
    return base;
  }

  // -------------------------------------------------------------------------
  // Creation & joining
  // -------------------------------------------------------------------------

  createRoom(input: CreateRoomInput): JoinOutcome {
    const displayName = this.requireName(input.displayName);
    const avatar = this.requireAvatar(input.avatar);
    const sessionId = input.sessionId || generateSessionId();

    const code = this.allocateUniqueCode();
    const now = Date.now();

    const room: RoomEntity = {
      code,
      phase: GamePhase.Lobby,
      hostId: '',
      settings: this.defaultSettings(),
      players: new Map(),
      round: 0,
      phaseEndsAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const player = this.makePlayer({
      sessionId,
      displayName,
      avatar,
      seat: 0,
      isHost: true,
    });
    room.hostId = player.id;
    room.players.set(player.id, player);

    this.store.set(room);
    this.store.indexSession(sessionId, code);
    this.logger.log(`Room ${code} created by ${displayName}`);

    return { room, player, sessionId, reconnected: false };
  }

  joinRoom(input: JoinRoomInput): JoinOutcome {
    const code = this.requireCode(input.code);
    const room = this.requireRoom(code);

    if (room.phase !== GamePhase.Lobby) {
      // If a game is in progress, only an existing member may rejoin (handled
      // by rejoinRoom). New joins are rejected.
      throw new RoomError(
        ErrorCode.WrongPhase,
        'This game has already started',
      );
    }

    // Reconnect path: same session already seated here.
    if (input.sessionId) {
      const existing = this.findPlayerBySession(room, input.sessionId);
      if (existing) {
        this.markConnected(existing);
        room.updatedAt = Date.now();
        return {
          room,
          player: existing,
          sessionId: input.sessionId,
          reconnected: true,
        };
      }
    }

    const displayName = this.requireName(input.displayName);
    const avatar = this.requireAvatar(input.avatar);

    const activeCount = [...room.players.values()].length;
    if (activeCount >= room.settings.maxPlayers) {
      throw new RoomError(ErrorCode.RoomFull, 'Room is full');
    }

    if (this.isNameTaken(room, displayName, null)) {
      throw new RoomError(
        ErrorCode.NameTaken,
        'That display name is already taken in this room',
      );
    }

    const sessionId = input.sessionId || generateSessionId();
    const seat = this.nextSeat(room);
    const player = this.makePlayer({
      sessionId,
      displayName,
      avatar,
      seat,
      isHost: false,
    });
    room.players.set(player.id, player);
    room.updatedAt = Date.now();

    this.store.indexSession(sessionId, code);
    this.logger.log(`${displayName} joined room ${code}`);

    return { room, player, sessionId, reconnected: false };
  }

  /** Rejoin a room by session after reload/disconnect, in any phase. */
  rejoinRoom(code: string, sessionId: string): JoinOutcome {
    const normalized = this.requireCode(code);
    const room = this.requireRoom(normalized);
    const player = this.findPlayerBySession(room, sessionId);
    if (!player) {
      throw new RoomError(
        ErrorCode.NotInRoom,
        'You are not a member of this room',
      );
    }
    this.markConnected(player);
    room.updatedAt = Date.now();
    return { room, player, sessionId, reconnected: true };
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  setReady(code: string, playerId: string, isReady: boolean): RoomEntity {
    const room = this.requireRoom(code);
    const player = this.requirePlayer(room, playerId);
    if (room.phase !== GamePhase.Lobby) {
      throw new RoomError(ErrorCode.WrongPhase, 'Can only ready up in lobby');
    }
    player.isReady = isReady;
    room.updatedAt = Date.now();
    return room;
  }

  updateProfile(
    code: string,
    playerId: string,
    patch: { displayName?: string; avatar?: string },
  ): RoomEntity {
    const room = this.requireRoom(code);
    const player = this.requirePlayer(room, playerId);
    if (room.phase !== GamePhase.Lobby) {
      throw new RoomError(
        ErrorCode.WrongPhase,
        'Can only change profile in lobby',
      );
    }
    if (patch.displayName !== undefined) {
      const name = this.requireName(patch.displayName);
      if (this.isNameTaken(room, name, playerId)) {
        throw new RoomError(ErrorCode.NameTaken, 'Display name already taken');
      }
      player.displayName = name;
    }
    if (patch.avatar !== undefined) {
      player.avatar = this.requireAvatar(patch.avatar);
    }
    room.updatedAt = Date.now();
    return room;
  }

  updateSettings(
    code: string,
    playerId: string,
    patch: Partial<RoomSettings>,
  ): RoomEntity {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== GamePhase.Lobby) {
      throw new RoomError(ErrorCode.WrongPhase, 'Can only change settings in lobby');
    }
    room.settings = this.mergeSettings(room.settings, patch);
    room.updatedAt = Date.now();
    return room;
  }

  /**
   * Validate that the host may start the game. Phase 1 only transitions to
   * RoleReveal to prove the authoritative flow; the full game loop arrives in
   * Phase 2.
   */
  canStart(room: RoomEntity): { ok: true } | { ok: false; error: RoomError } {
    const players = [...room.players.values()];
    const connected = players.filter(
      (p) => p.connection === ConnectionStatus.Connected || p.kind === PlayerKind.Ai,
    );
    if (connected.length < room.settings.minPlayers) {
      return {
        ok: false,
        error: new RoomError(
          ErrorCode.NotEnoughPlayers,
          `Need at least ${room.settings.minPlayers} players to start`,
        ),
      };
    }
    const humans = players.filter((p) => p.kind === PlayerKind.Human);
    const allReady = humans.every((p) => p.isReady || p.isHost);
    if (!allReady) {
      return {
        ok: false,
        error: new RoomError(
          ErrorCode.ActionNotAllowed,
          'All players must be ready before starting',
        ),
      };
    }
    return { ok: true };
  }

  startGame(code: string, playerId: string): RoomEntity {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== GamePhase.Lobby) {
      throw new RoomError(ErrorCode.WrongPhase, 'Game already started');
    }
    const check = this.canStart(room);
    if (!check.ok) throw check.error;

    // Phase 1: transition into RoleReveal placeholder. The deterministic game
    // engine (role assignment, night/day loop) is implemented in Phase 2.
    room.phase = GamePhase.RoleReveal;
    room.round = 1;
    room.phaseEndsAt = null;
    room.updatedAt = Date.now();
    this.logger.log(`Room ${code} started game`);
    return room;
  }

  /**
   * Validate (host + readiness + player count) that a game may start, returning
   * the room WITHOUT mutating it. The GameService performs the actual transition
   * (role assignment + scheduling) so game logic stays in one place.
   */
  assertCanStart(code: string, playerId: string): RoomEntity {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== GamePhase.Lobby) {
      throw new RoomError(ErrorCode.WrongPhase, 'Game already started');
    }
    const check = this.canStart(room);
    if (!check.ok) throw check.error;
    return room;
  }

  /** Validate that a finished game may be restarted by the host. */
  assertCanRematch(code: string, playerId: string): RoomEntity {
    const room = this.requireRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== GamePhase.GameOver) {
      throw new RoomError(ErrorCode.WrongPhase, 'Game is not over yet');
    }
    return room;
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  attachSocket(code: string, playerId: string, socketId: string): void {
    const room = this.store.get(code);
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;
    player.socketId = socketId;
    this.markConnected(player);
    room.updatedAt = Date.now();
  }

  /**
   * Mark a player disconnected. Returns the room if it still exists. During
   * lobby, a disconnected non-host player is removed after the grace period
   * (handled by the gateway's timer); here we only flip status.
   */
  markDisconnected(code: string, playerId: string): RoomEntity | undefined {
    const room = this.store.get(code);
    if (!room) return undefined;
    const player = room.players.get(playerId);
    if (!player) return room;
    player.connection = ConnectionStatus.Disconnected;
    player.socketId = null;
    player.disconnectedAt = Date.now();
    player.isReady = false;
    room.updatedAt = Date.now();
    return room;
  }

  /**
   * Remove a player from a room (explicit leave, or grace expiry). Reassigns the
   * host if needed and deletes the room when empty of humans. Returns the
   * updated room, or undefined if the room was deleted.
   */
  removePlayer(code: string, playerId: string): RoomEntity | undefined {
    const room = this.store.get(code);
    if (!room) return undefined;
    const player = room.players.get(playerId);
    if (!player) return room;

    this.store.unindexSession(player.sessionId);
    room.players.delete(playerId);

    const remainingHumans = [...room.players.values()].filter(
      (p) => p.kind === PlayerKind.Human,
    );
    if (remainingHumans.length === 0) {
      this.store.delete(code);
      this.logger.log(`Room ${code} deleted (empty)`);
      return undefined;
    }

    if (room.hostId === playerId) {
      // Promote the next-seated connected human to host.
      const next =
        remainingHumans.find(
          (p) => p.connection === ConnectionStatus.Connected,
        ) ?? remainingHumans[0];
      next.isHost = true;
      room.hostId = next.id;
      this.logger.log(`Room ${code} host reassigned to ${next.displayName}`);
    }
    room.updatedAt = Date.now();
    return room;
  }

  getRoom(code: string): RoomEntity | undefined {
    const normalized = normalizeRoomCode(code);
    if (!normalized.ok) return undefined;
    return this.store.get(normalized.value);
  }

  findRoomBySession(sessionId: string): RoomEntity | undefined {
    return this.store.findRoomBySession(sessionId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private makePlayer(args: {
    sessionId: string;
    displayName: string;
    avatar: string;
    seat: number;
    isHost: boolean;
    kind?: PlayerKind;
  }): ServerPlayer {
    return {
      id: generatePlayerId(),
      sessionId: args.sessionId,
      socketId: null,
      displayName: args.displayName,
      avatar: args.avatar,
      kind: args.kind ?? PlayerKind.Human,
      isHost: args.isHost,
      isReady: false,
      status: PlayerStatus.Alive,
      connection: ConnectionStatus.Connected,
      seat: args.seat,
      joinedAt: Date.now(),
      disconnectedAt: null,
    };
  }

  private markConnected(player: ServerPlayer): void {
    player.connection = ConnectionStatus.Connected;
    player.disconnectedAt = null;
  }

  private nextSeat(room: RoomEntity): number {
    const seats = [...room.players.values()].map((p) => p.seat);
    let seat = 0;
    while (seats.includes(seat)) seat++;
    return seat;
  }

  private allocateUniqueCode(): string {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      if (!this.store.has(code)) return code;
    }
    throw new RoomError(ErrorCode.Unknown, 'Failed to allocate room code');
  }

  private isNameTaken(
    room: RoomEntity,
    name: string,
    exceptPlayerId: string | null,
  ): boolean {
    const lower = name.toLowerCase();
    return [...room.players.values()].some(
      (p) => p.id !== exceptPlayerId && p.displayName.toLowerCase() === lower,
    );
  }

  private findPlayerBySession(
    room: RoomEntity,
    sessionId: string,
  ): ServerPlayer | undefined {
    return [...room.players.values()].find((p) => p.sessionId === sessionId);
  }

  private mergeSettings(
    current: RoomSettings,
    patch: Partial<RoomSettings>,
  ): RoomSettings {
    const next: RoomSettings = {
      ...current,
      ...patch,
      phaseDurations: {
        ...current.phaseDurations,
        ...(patch.phaseDurations ?? {}),
      },
    };
    // Clamp to supported bounds.
    next.minPlayers = this.clamp(next.minPlayers, MIN_PLAYERS, MAX_PLAYERS);
    next.maxPlayers = this.clamp(next.maxPlayers, next.minPlayers, MAX_PLAYERS);
    const d = next.phaseDurations;
    d.roleReveal = this.clamp(d.roleReveal, 3, 30);
    d.night = this.clamp(d.night, 10, 180);
    d.day = this.clamp(d.day, 15, 300);
    d.voting = this.clamp(d.voting, 10, 180);
    d.elimination = this.clamp(d.elimination, 3, 30);
    return next;
  }

  private clamp(v: number, min: number, max: number): number {
    if (Number.isNaN(v)) return min;
    return Math.max(min, Math.min(max, Math.round(v)));
  }

  // --- guards ---

  private requireRoom(code: string): RoomEntity {
    const room = this.store.get(code);
    if (!room) throw new RoomError(ErrorCode.RoomNotFound, 'Room not found');
    return room;
  }

  private requirePlayer(room: RoomEntity, playerId: string): ServerPlayer {
    const player = room.players.get(playerId);
    if (!player)
      throw new RoomError(ErrorCode.NotInRoom, 'You are not in this room');
    return player;
  }

  private requireHost(room: RoomEntity, playerId: string): ServerPlayer {
    const player = this.requirePlayer(room, playerId);
    if (!player.isHost || room.hostId !== playerId) {
      throw new RoomError(ErrorCode.NotHost, 'Only the host can do that');
    }
    return player;
  }

  private requireName(raw: string): string {
    const res = sanitizeDisplayName(raw);
    if (!res.ok) throw new RoomError(ErrorCode.Validation, res.reason);
    return res.value;
  }

  private requireAvatar(raw: string): string {
    const res = sanitizeAvatar(raw);
    if (!res.ok) throw new RoomError(ErrorCode.Validation, res.reason);
    return res.value;
  }

  private requireCode(raw: string): string {
    const res = normalizeRoomCode(raw);
    if (!res.ok) throw new RoomError(ErrorCode.Validation, res.reason);
    return res.value;
  }
}
