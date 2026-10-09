'use client';

import type { SessionIdentity } from '@ai-mafia/shared';
import { AVATARS } from '@ai-mafia/shared';

const KEY = 'ai-mafia:identity';

function randomAvatar(): string {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

/** Read the stored guest identity, if any. */
export function loadIdentity(): SessionIdentity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionIdentity>;
    // A stored identity is valid once it has a name + avatar. The sessionId is
    // issued by the server on first join, so it may legitimately be empty here.
    if (!parsed.displayName || !parsed.avatar) return null;
    return {
      sessionId: parsed.sessionId ?? '',
      displayName: parsed.displayName,
      avatar: parsed.avatar,
    };
  } catch {
    return null;
  }
}

/** Persist the guest identity (name + avatar chosen by the player). */
export function saveIdentity(identity: SessionIdentity): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(identity));
}

/** Update stored fields (e.g. after the server issues a new sessionId). */
export function patchIdentity(patch: Partial<SessionIdentity>): SessionIdentity {
  const current = loadIdentity() ?? {
    sessionId: '',
    displayName: '',
    avatar: randomAvatar(),
  };
  const next = { ...current, ...patch };
  saveIdentity(next);
  return next;
}

export function clearSessionId(): void {
  const current = loadIdentity();
  if (current) saveIdentity({ ...current, sessionId: '' });
}

export { randomAvatar };
