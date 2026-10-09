import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  AckResult,
  ChatSendPayload,
  ClientToServerEvents,
  CreateRoomPayload,
  ErrorCode,
  JoinRoomPayload,
  JoinedRoomData,
  PublicRoomState,
  ReadyPayload,
  RejoinRoomPayload,
  ServerToClientEvents,
  SocketHandshakeAuth,
  UpdateProfilePayload,
  UpdateSettingsPayload,
  sanitizeChat,
} from '@ai-mafia/shared';
import { RoomsService } from './rooms.service';
import { RoomError } from './room.error';
import { RoomEntity } from './room.entity';
import { toPublicRoomState } from './room.entity';
import { RateLimiterService } from '../common/rate-limiter.service';
import { generateMessageId } from '../common/ids';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Per-socket binding to a seated player. */
interface SocketContext {
  sessionId: string;
  roomCode: string;
  playerId: string;
}

const ok = <T>(data: T): AckResult<T> => ({ ok: true, data });
const fail = (code: ErrorCode, message: string): AckResult<never> => ({
  ok: false,
  error: { code, message },
});

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
  },
})
export class RoomsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RoomsGateway.name);

  @WebSocketServer()
  server!: IoServer;

  /** socketId -> context */
  private readonly contexts = new Map<string, SocketContext>();
  /** playerId -> pending grace-removal timer */
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly rooms: RoomsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  handleConnection(client: IoSocket): void {
    const auth = (client.handshake.auth ?? {}) as SocketHandshakeAuth;
    this.logger.debug(
      `socket connected ${client.id} session=${auth.sessionId ?? 'none'}`,
    );
  }

  handleDisconnect(client: IoSocket): void {
    const ctx = this.contexts.get(client.id);
    this.contexts.delete(client.id);
    if (!ctx) return;

    const room = this.rooms.markDisconnected(ctx.roomCode, ctx.playerId);
    if (room) this.broadcastRoom(room);

    // Grace period: remove the seat if the player doesn't reconnect.
    const timer = setTimeout(() => {
      this.graceTimers.delete(ctx.playerId);
      const current = this.rooms.getRoom(ctx.roomCode);
      const player = current?.players.get(ctx.playerId);
      if (player && player.connection === 'DISCONNECTED') {
        const updated = this.rooms.removePlayer(ctx.roomCode, ctx.playerId);
        if (updated) {
          this.server.to(ctx.roomCode).emit('player:left', ctx.playerId);
          this.broadcastRoom(updated);
        }
      }
    }, RoomsService.RECONNECT_GRACE_MS);
    this.graceTimers.set(ctx.playerId, timer);
  }

  // -------------------------------------------------------------------------
  // Room events
  // -------------------------------------------------------------------------

  @SubscribeMessage('room:create')
  handleCreate(
    @ConnectedSocket() client: IoSocket,
    @MessageBody() payload: CreateRoomPayload,
  ): AckResult<JoinedRoomData> {
    if (!this.rateLimiter.consume(`${client.id}:create`, 5, 0.2)) {
      return fail(ErrorCode.RateLimited, 'Slow down a moment');
    }
    return this.guard(() => {
      const auth = (client.handshake.auth ?? {}) as SocketHandshakeAuth;
      const outcome = this.rooms.createRoom({
        sessionId: auth.sessionId,
        displayName: payload?.displayName,
        avatar: payload?.avatar,
      });
      this.bindSocket(client, outcome.room, outcome.player.id, outcome.sessionId);
      return ok<JoinedRoomData>({
        selfId: outcome.player.id,
        sessionId: outcome.sessionId,
        room: toPublicRoomState(outcome.room),
      });
    });
  }

  @SubscribeMessage('room:join')
  handleJoin(
    @ConnectedSocket() client: IoSocket,
    @MessageBody() payload: JoinRoomPayload,
  ): AckResult<JoinedRoomData> {
    if (!this.rateLimiter.consume(`${client.id}:join`, 10, 1)) {
      return fail(ErrorCode.RateLimited, 'Slow down a moment');
    }
    return this.guard(() => {
      const auth = (client.handshake.auth ?? {}) as SocketHandshakeAuth;
      const outcome = this.rooms.joinRoom({
        code: payload?.code,
        sessionId: auth.sessionId,
        displayName: payload?.displayName,
        avatar: payload?.avatar,
      });
      this.bindSocket(client, outcome.room, outcome.player.id, outcome.sessionId);
      if (!outcome.reconnected) {
        client
          .to(outcome.room.code)
          .emit('player:joined', this.publicPlayer(outcome.room, outcome.player.id));
      }
      this.broadcastRoom(outcome.room);
      return ok<JoinedRoomData>({
        selfId: outcome.player.id,
        sessionId: outcome.sessionId,
        room: toPublicRoomState(outcome.room),
      });
    });
  }

  @SubscribeMessage('room:rejoin')
  handleRejoin(
    @ConnectedSocket() client: IoSocket,
    @MessageBody() payload: RejoinRoomPayload,
  ): AckResult<JoinedRoomData> {
    return this.guard(() => {
      const auth = (client.handshake.auth ?? {}) as SocketHandshakeAuth;
      // Prefer the explicit payload token; fall back to handshake auth.
      const sessionId = payload?.sessionId || auth.sessionId;
      if (!sessionId) {
        return fail(ErrorCode.NotAuthorized, 'No session to rejoin with');
      }
      const outcome = this.rooms.rejoinRoom(payload?.code, sessionId);
      this.bindSocket(client, outcome.room, outcome.player.id, outcome.sessionId);
      this.broadcastRoom(outcome.room);
      return ok<JoinedRoomData>({
        selfId: outcome.player.id,
        sessionId: outcome.sessionId,
        room: toPublicRoomState(outcome.room),
      });
    });
  }

  @SubscribeMessage('room:leave')
  handleLeave(
    @ConnectedSocket() client: IoSocket,
  ): AckResult<{ left: true }> {
    const ctx = this.requireContext(client);
    if (!ctx) return fail(ErrorCode.NotInRoom, 'You are not in a room');
    const updated = this.rooms.removePlayer(ctx.roomCode, ctx.playerId);
    this.contexts.delete(client.id);
    client.leave(ctx.roomCode);
    this.server.to(ctx.roomCode).emit('player:left', ctx.playerId);
    if (updated) this.broadcastRoom(updated);
    return ok({ left: true } as const);
  }

  @SubscribeMessage('player:ready')
  handleReady(
    @ConnectedSocket() client: IoSocket,
    @MessageBody() payload: ReadyPayload,
  ): AckResult<PublicRoomState> {
    const ctx = this.requireContext(client);
    if (!ctx) return fail(ErrorCode.NotInRoom, 'You are not in a room');
    return this.guard(() => {
      const room = this.rooms.setReady(
        ctx.roomCode,
        ctx.playerId,
        Boolean(payload?.isReady),
      );
      this.broadcastRoom(room);
      return ok(toPublicRoomState(room));
    });
  }

  @SubscribeMessage('player:update')
  handleUpdate(
    @ConnectedSocket() client: IoSocket,
    @MessageBody() payload: UpdateProfilePayload,
  ): AckResult<PublicRoomState> {
    const ctx = this.requireContext(client);
    if (!ctx) return fail(ErrorCode.NotInRoom, 'You are not in a room');
    return this.guard(() => {
      const room = this.rooms.updateProfile(ctx.roomCode, ctx.playerId, {
        displayName: payload?.displayName,
        avatar: payload?.avatar,
      });
      this.broadcastRoom(room);
      return ok(toPublicRoomState(room));
    });
  }

  @SubscribeMessage('room:settings')
  handleSettings(
    @ConnectedSocket() client: IoSocket,
    @MessageBody() payload: UpdateSettingsPayload,
  ): AckResult<PublicRoomState> {
    const ctx = this.requireContext(client);
    if (!ctx) return fail(ErrorCode.NotInRoom, 'You are not in a room');
    return this.guard(() => {
      const room = this.rooms.updateSettings(
        ctx.roomCode,
        ctx.playerId,
        payload?.settings ?? {},
      );
      this.broadcastRoom(room);
      return ok(toPublicRoomState(room));
    });
  }

  @SubscribeMessage('game:start')
  handleStart(
    @ConnectedSocket() client: IoSocket,
  ): AckResult<PublicRoomState> {
    const ctx = this.requireContext(client);
    if (!ctx) return fail(ErrorCode.NotInRoom, 'You are not in a room');
    return this.guard(() => {
      const room = this.rooms.startGame(ctx.roomCode, ctx.playerId);
      const publicState = toPublicRoomState(room);
      this.server.to(room.code).emit('game:started', publicState);
      this.server.to(room.code).emit('phase:changed', {
        phase: room.phase,
        round: room.round,
        phaseEndsAt: room.phaseEndsAt,
        announcement: 'The game is about to begin...',
      });
      this.broadcastRoom(room);
      return ok(publicState);
    });
  }

  @SubscribeMessage('chat:send')
  handleChat(
    @ConnectedSocket() client: IoSocket,
    @MessageBody() payload: ChatSendPayload,
  ): AckResult<{ accepted: true }> {
    const ctx = this.requireContext(client);
    if (!ctx) return fail(ErrorCode.NotInRoom, 'You are not in a room');
    if (!this.rateLimiter.consume(`${client.id}:chat`, 5, 1)) {
      return fail(ErrorCode.RateLimited, 'You are sending messages too fast');
    }
    const clean = sanitizeChat(payload?.text);
    if (!clean.ok) return fail(ErrorCode.Validation, clean.reason);

    const room = this.rooms.getRoom(ctx.roomCode);
    if (!room) return fail(ErrorCode.RoomNotFound, 'Room not found');
    const player = room.players.get(ctx.playerId);
    if (!player) return fail(ErrorCode.NotInRoom, 'You are not in this room');

    this.server.to(room.code).emit('chat:message', {
      id: generateMessageId(),
      roomCode: room.code,
      authorId: player.id,
      authorName: player.displayName,
      text: clean.value,
      at: Date.now(),
      system: false,
    });
    return ok({ accepted: true } as const);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private bindSocket(
    client: IoSocket,
    room: RoomEntity,
    playerId: string,
    sessionId: string,
  ): void {
    // Cancel any pending grace removal for this player (reconnect).
    const timer = this.graceTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(playerId);
    }
    this.contexts.set(client.id, {
      sessionId,
      roomCode: room.code,
      playerId,
    });
    client.join(room.code);
    this.rooms.attachSocket(room.code, playerId, client.id);
  }

  private broadcastRoom(room: RoomEntity): void {
    this.server.to(room.code).emit('room:updated', toPublicRoomState(room));
  }

  private publicPlayer(room: RoomEntity, playerId: string) {
    const p = room.players.get(playerId)!;
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

  private requireContext(client: IoSocket): SocketContext | null {
    return this.contexts.get(client.id) ?? null;
  }

  /** Run a handler, converting RoomError into a typed ack failure. */
  private guard<T>(fn: () => AckResult<T>): AckResult<T> {
    try {
      return fn();
    } catch (err) {
      if (err instanceof RoomError) {
        return { ok: false, error: err.toSocketError() };
      }
      this.logger.error('Unexpected gateway error', err as Error);
      return fail(ErrorCode.Unknown, 'Unexpected server error');
    }
  }
}
