'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  JoinedRoomData,
  PhaseChangedPayload,
  PublicRoomState,
  SocketHandshakeAuth,
} from '@ai-mafia/shared';
import { emitWithAck, getSocket, TypedSocket } from './socket';
import { loadIdentity, patchIdentity } from './identity';

export type ConnPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface RoomClient {
  conn: ConnPhase;
  room: PublicRoomState | null;
  selfId: string | null;
  messages: ChatMessage[];
  lastPhaseEvent: PhaseChangedPayload | null;
  createRoom: (name: string, avatar: string) => Promise<ActionResult<JoinedRoomData>>;
  joinRoom: (code: string, name: string, avatar: string) => Promise<ActionResult<JoinedRoomData>>;
  rejoin: (code: string) => Promise<ActionResult<JoinedRoomData>>;
  setReady: (ready: boolean) => Promise<ActionResult<PublicRoomState>>;
  updateProfile: (patch: { displayName?: string; avatar?: string }) => Promise<ActionResult<PublicRoomState>>;
  startGame: () => Promise<ActionResult<PublicRoomState>>;
  sendChat: (text: string) => Promise<ActionResult<{ accepted: true }>>;
  leaveRoom: () => Promise<void>;
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

function authFromIdentity(): SocketHandshakeAuth {
  const id = loadIdentity();
  return {
    sessionId: id?.sessionId || undefined,
    displayName: id?.displayName || undefined,
    avatar: id?.avatar || undefined,
  };
}

/**
 * Owns the realtime connection and room state for a session. One instance per
 * mounted lobby/game page. Keeps server broadcasts as the source of truth.
 */
export function useRoomClient(): RoomClient {
  const [conn, setConn] = useState<ConnPhase>('idle');
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastPhaseEvent, setLastPhaseEvent] =
    useState<PhaseChangedPayload | null>(null);
  const socketRef = useRef<TypedSocket | null>(null);

  // Establish the connection + server->client listeners once.
  useEffect(() => {
    const sock = getSocket(authFromIdentity());
    socketRef.current = sock;
    setConn(sock.connected ? 'connected' : 'connecting');

    const onConnect = () => setConn('connected');
    const onDisconnect = () => setConn('disconnected');
    const onReconnectAttempt = () => setConn('reconnecting');
    const onRoomUpdated = (r: PublicRoomState) => setRoom(r);
    const onChat = (m: ChatMessage) =>
      setMessages((prev) => [...prev.slice(-199), m]);
    const onPhase = (p: PhaseChangedPayload) => {
      setLastPhaseEvent(p);
      setRoom((prev) =>
        prev
          ? { ...prev, phase: p.phase, round: p.round, phaseEndsAt: p.phaseEndsAt }
          : prev,
      );
    };

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.io.on('reconnect_attempt', onReconnectAttempt);
    sock.io.on('reconnect', onConnect);
    sock.on('room:updated', onRoomUpdated);
    sock.on('chat:message', onChat);
    sock.on('phase:changed', onPhase);

    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.io.off('reconnect_attempt', onReconnectAttempt);
      sock.io.off('reconnect', onConnect);
      sock.off('room:updated', onRoomUpdated);
      sock.off('chat:message', onChat);
      sock.off('phase:changed', onPhase);
    };
  }, []);

  const ensureSocket = useCallback((): TypedSocket => {
    const sock = socketRef.current ?? getSocket(authFromIdentity());
    socketRef.current = sock;
    sock.auth = authFromIdentity() as Record<string, unknown>;
    if (!sock.connected) sock.connect();
    return sock;
  }, []);

  const createRoom = useCallback(
    async (name: string, avatar: string): Promise<ActionResult<JoinedRoomData>> => {
      patchIdentity({ displayName: name, avatar });
      const sock = ensureSocket();
      const res = await emitWithAck<JoinedRoomData>(sock, 'room:create', {
        displayName: name,
        avatar,
      });
      if (!res.ok) return { ok: false, message: res.error.message };
      applyJoin(res.data);
      return { ok: true, data: res.data };
    },
    [ensureSocket],
  );

  const joinRoom = useCallback(
    async (
      code: string,
      name: string,
      avatar: string,
    ): Promise<ActionResult<JoinedRoomData>> => {
      patchIdentity({ displayName: name, avatar });
      const sock = ensureSocket();
      const res = await emitWithAck<JoinedRoomData>(sock, 'room:join', {
        code,
        displayName: name,
        avatar,
      });
      if (!res.ok) return { ok: false, message: res.error.message };
      applyJoin(res.data);
      return { ok: true, data: res.data };
    },
    [ensureSocket],
  );

  const rejoin = useCallback(
    async (code: string): Promise<ActionResult<JoinedRoomData>> => {
      const sock = ensureSocket();
      const res = await emitWithAck<JoinedRoomData>(sock, 'room:rejoin', {
        code,
      });
      if (!res.ok) return { ok: false, message: res.error.message };
      applyJoin(res.data);
      return { ok: true, data: res.data };
    },
    [ensureSocket],
  );

  function applyJoin(data: JoinedRoomData) {
    setSelfId(data.selfId);
    setRoom(data.room);
  }

  const setReady = useCallback(
    async (ready: boolean): Promise<ActionResult<PublicRoomState>> => {
      const sock = ensureSocket();
      const res = await emitWithAck<PublicRoomState>(sock, 'player:ready', {
        isReady: ready,
      });
      if (!res.ok) return { ok: false, message: res.error.message };
      setRoom(res.data);
      return { ok: true, data: res.data };
    },
    [ensureSocket],
  );

  const updateProfile = useCallback(
    async (patch: {
      displayName?: string;
      avatar?: string;
    }): Promise<ActionResult<PublicRoomState>> => {
      const sock = ensureSocket();
      const res = await emitWithAck<PublicRoomState>(sock, 'player:update', patch);
      if (!res.ok) return { ok: false, message: res.error.message };
      if (patch.displayName || patch.avatar) patchIdentity(patch);
      setRoom(res.data);
      return { ok: true, data: res.data };
    },
    [ensureSocket],
  );

  const startGame = useCallback(async (): Promise<
    ActionResult<PublicRoomState>
  > => {
    const sock = ensureSocket();
    const res = await emitWithAck<PublicRoomState>(sock, 'game:start');
    if (!res.ok) return { ok: false, message: res.error.message };
    setRoom(res.data);
    return { ok: true, data: res.data };
  }, [ensureSocket]);

  const sendChat = useCallback(
    async (text: string): Promise<ActionResult<{ accepted: true }>> => {
      const sock = ensureSocket();
      const res = await emitWithAck<{ accepted: true }>(sock, 'chat:send', {
        text,
      });
      if (!res.ok) return { ok: false, message: res.error.message };
      return { ok: true, data: res.data };
    },
    [ensureSocket],
  );

  const leaveRoom = useCallback(async (): Promise<void> => {
    const sock = socketRef.current;
    if (sock) await emitWithAck(sock, 'room:leave');
    setRoom(null);
    setSelfId(null);
    setMessages([]);
  }, []);

  return {
    conn,
    room,
    selfId,
    messages,
    lastPhaseEvent,
    createRoom,
    joinRoom,
    rejoin,
    setReady,
    updateProfile,
    startGame,
    sendChat,
    leaveRoom,
  };
}
