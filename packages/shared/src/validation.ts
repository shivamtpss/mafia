import { AVATARS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './config';

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 16;
export const CHAT_MAX_LENGTH = 300;

/** Validation result helper. */
export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export function sanitizeDisplayName(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return { ok: false, reason: 'Name required' };
  // Collapse whitespace, strip control chars.
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < DISPLAY_NAME_MIN)
    return { ok: false, reason: `Name must be at least ${DISPLAY_NAME_MIN} characters` };
  if (cleaned.length > DISPLAY_NAME_MAX)
    return { ok: false, reason: `Name must be at most ${DISPLAY_NAME_MAX} characters` };
  return { ok: true, value: cleaned };
}

export function sanitizeAvatar(raw: unknown): Validated<string> {
  if (typeof raw !== 'string' || !AVATARS.includes(raw as never))
    return { ok: false, reason: 'Invalid avatar' };
  return { ok: true, value: raw };
}

export function normalizeRoomCode(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return { ok: false, reason: 'Code required' };
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH)
    return { ok: false, reason: 'Invalid room code length' };
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch))
      return { ok: false, reason: 'Invalid room code' };
  }
  return { ok: true, value: code };
}

export function sanitizeChat(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return { ok: false, reason: 'Message required' };
  const cleaned = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (cleaned.length === 0) return { ok: false, reason: 'Empty message' };
  if (cleaned.length > CHAT_MAX_LENGTH)
    return { ok: false, reason: `Message too long (max ${CHAT_MAX_LENGTH})` };
  return { ok: true, value: cleaned };
}
