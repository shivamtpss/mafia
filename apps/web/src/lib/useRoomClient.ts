'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  EliminationPayload,
  GameFinishedPayload,
  InvestigationResultPayload,
  JoinedRoomData,
  PhaseChangedPayload,
  PrivateRoleInfo,
  PublicRoomState,
  SocketHandshakeAuth,
  VoteTally,
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
  /** Private role info for this player (received on game start). */
  role: PrivateRoleInfo | null;
  /** Private detective investigation results, newest last. */
  investigations: InvestigationResultPayload[];
  /** Latest public vote tally during the voting phase. */
  tally: VoteTally | null;
  /** Latest elimination announcement. */
  lastElimination: EliminationPayload | null;
  /** Final results once the game ends. */
  finished: GameFinishedPayload | null;
  createRoom: (name: string, avatar: string) => Promise<ActionResult<JoinedRoomData>>;
  joinRoom: (code: string, name: string, avatar: string) => Promise<ActionResult<JoinedRoomData>>;
  rejoin: (code: string) => Promise<ActionResult<JoinedRoomData>>;
  setReady: (ready: boolean) => Promise<ActionResult<PublicRoomState>>;
  updateProfile: (patch: { displayName?: string; avatar?: string }) => Promise<ActionResult<PublicRoomState>>;
  updateSettings: (patch: { themeId?: string }) => Promise<ActionResult<PublicRoomState>>;
  startGame: () => Promise<ActionResult<PublicRoomState>>;
  rematch: () => Promise<ActionResult<PublicRoomState>>;
  submitNightAction: (targetId: string | null) => Promise<ActionResult<{ accepted: true }>>;
  castVote: (targetId: string | null) => Promise<ActionResult<{ accepted: true }>>;
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
  const [role, setRole] = useState<PrivateRoleInfo | null>(null);
  const [investigations, setInvestigations] = useState<
    InvestigationResultPayload[]
  >([]);
  const [tally, setTally] = useState<VoteTally | null>(null);
  const [lastElimination, setLastElimination] =
    useState<EliminationPayload | null>(null);
  const [finished, setFinished] = useState<GameFinishedPayload | null>(null);
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
    const onRole = (info: PrivateRoleInfo) => setRole(info);
    const onInvestigation = (p: InvestigationResultPayload) =>
      setInvestigations((prev) => [...prev, p]);
    const onVote = (t: VoteTally) => setTally(t);
    const onElim = (p: EliminationPayload) => setLastElimination(p);
    const onFinished = (p: GameFinishedPayload) => setFinished(p);
    // A fresh game started: clear chat + prior-game state so narration/votes
    // from a previous match (possibly a different theme) don't linger.
    const onGameStarted = (r: PublicRoomState) => {
      setRoom(r);
      setMessages([]);
      setInvestigations([]);
      setTally(null);
      setLastElimination(null);
      setFinished(null);
    };

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.io.on('reconnect_attempt', onReconnectAttempt);
    sock.io.on('reconnect', onConnect);
    sock.on('room:updated', onRoomUpdated);
    sock.on('chat:message', onChat);
    sock.on('phase:changed', onPhase);
    sock.on('game:started', onGameStarted);
    sock.on('role:assigned', onRole);
    sock.on('investigation:result', onInvestigation);
    sock.on('vote:updated', onVote);
    sock.on('player:eliminated', onElim);
    sock.on('game:finished', onFinished);

    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.io.off('reconnect_attempt', onReconnectAttempt);
      sock.io.off('reconnect', onConnect);
      sock.off('room:updated', onRoomUpdated);
      sock.off('chat:message', onChat);
      sock.off('phase:changed', onPhase);
      sock.off('game:started', onGameStarted);
      sock.off('role:assigned', onRole);
      sock.off('investigation:result', onInvestigation);
      sock.off('vote:updated', onVote);
      sock.off('player:eliminated', onElim);
      sock.off('game:finished', onFinished);
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
      const id = loadIdentity();
      const res = await emitWithAck<JoinedRoomData>(sock, 'room:rejoin', {
        code,
        sessionId: id?.sessionId || undefined,
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
    // Persist the server-issued session token so a reload/reconnect can reclaim
    // this exact seat via room:rejoin. Also refresh the live socket's auth.
    patchIdentity({ sessionId: data.sessionId });
    const sock = socketRef.current;
    if (sock) {
      sock.auth = authFromIdentity() as Record<string, unknown>;
    }
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

  const updateSettings = useCallback(
    async (patch: { themeId?: string }): Promise<ActionResult<PublicRoomState>> => {
      const sock = ensureSocket();
      const res = await emitWithAck<PublicRoomState>(sock, 'room:settings', {
        settings: patch,
      });
      if (!res.ok) return { ok: false, message: res.error.message };
      setRoom(res.data);
      return { ok: true, data: res.data };
    },
    [ensureSocket],
  );

  const rematch = useCallback(async (): Promise<
    ActionResult<PublicRoomState>
  > => {
    const sock = ensureSocket();
    const res = await emitWithAck<PublicRoomState>(sock, 'game:rematch');
    if (!res.ok) return { ok: false, message: res.error.message };
    // Clear per-game state so the lobby is clean for the next match.
    setRole(null);
    setInvestigations([]);
    setTally(null);
    setLastElimination(null);
    setFinished(null);
    setRoom(res.data);
    return { ok: true, data: res.data };
  }, [ensureSocket]);

  const submitNightAction = useCallback(
    async (targetId: string | null): Promise<ActionResult<{ accepted: true }>> => {
      const sock = ensureSocket();
      const res = await emitWithAck<{ accepted: true }>(sock, 'night:action', {
        targetId,
      });
      if (!res.ok) return { ok: false, message: res.error.message };
      return { ok: true, data: res.data };
    },
    [ensureSocket],
  );

  const castVote = useCallback(
    async (targetId: string | null): Promise<ActionResult<{ accepted: true }>> => {
      const sock = ensureSocket();
      const res = await emitWithAck<{ accepted: true }>(sock, 'vote:cast', {
        targetId,
      });
      if (!res.ok) return { ok: false, message: res.error.message };
      return { ok: true, data: res.data };
    },
    [ensureSocket],
  );

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
    setRole(null);
    setInvestigations([]);
    setTally(null);
    setLastElimination(null);
    setFinished(null);
  }, []);

  return {
    conn,
    room,
    selfId,
    messages,
    lastPhaseEvent,
    role,
    investigations,
    tally,
    lastElimination,
    finished,
    createRoom,
    joinRoom,
    rejoin,
    setReady,
    updateProfile,
    updateSettings,
    startGame,
    rematch,
    submitNightAction,
    castVote,
    sendChat,
    leaveRoom,
  };
}
