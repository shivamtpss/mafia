import { randomBytes, randomUUID } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@ai-mafia/shared';

/** Generate a random, unambiguous room code using the shared alphabet. */
export function generateRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

/** Opaque, unguessable player id (per room). */
export function generatePlayerId(): string {
  return `p_${randomUUID()}`;
}

/** Opaque guest session token. */
export function generateSessionId(): string {
  return `s_${randomUUID()}`;
}

export function generateMessageId(): string {
  return `m_${randomUUID()}`;
}
