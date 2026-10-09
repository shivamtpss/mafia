import { ErrorCode, SocketError } from '@ai-mafia/shared';

/**
 * Domain error carrying a stable {@link ErrorCode}. The gateway converts this
 * into an ack `{ ok: false, error }` instead of throwing over the wire.
 */
export class RoomError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoomError';
  }

  toSocketError(): SocketError {
    return { code: this.code, message: this.message };
  }
}
