'use client';

import { io, Socket } from 'socket.io-client';
import type {
  AckResult,
  ClientToServerEvents,
  ServerToClientEvents,
  SocketHandshakeAuth,
} from '@ai-mafia/shared';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

let socket: TypedSocket | null = null;

/** Lazily create (or return) the singleton socket with current auth. */
export function getSocket(auth: SocketHandshakeAuth): TypedSocket {
  if (socket) {
    socket.auth = auth as Record<string, unknown>;
    if (!socket.connected) socket.connect();
    return socket;
  }
  socket = io(SERVER_URL, {
    auth: auth as Record<string, unknown>,
    transports: ['websocket'],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  }) as TypedSocket;
  return socket;
}

export function getExistingSocket(): TypedSocket | null {
  return socket;
}

/**
 * Promise wrapper around an emit with an acknowledgement callback. Rejects on
 * timeout so callers always resolve. Event args are passed through verbatim.
 */
export function emitWithAck<T>(
  sock: TypedSocket,
  event: keyof ClientToServerEvents,
  payload?: unknown,
  timeoutMs = 7000,
): Promise<AckResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        error: { code: 'UNKNOWN' as never, message: 'Request timed out' },
      });
    }, timeoutMs);

    const cb = (res: AckResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    // socket.io supports omitting the payload for events that take only an ack.
    if (payload === undefined) {
      (sock.emit as (e: string, cb: unknown) => void)(event as string, cb);
    } else {
      (sock.emit as (e: string, p: unknown, cb: unknown) => void)(
        event as string,
        payload,
        cb,
      );
    }
  });
}
