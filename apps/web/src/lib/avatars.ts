// Maps the shared avatar ids to emoji + accent colors for lightweight,
// dependency-free rendering. Cosmetic avatars (Phase 7) can replace these.
export const AVATAR_EMOJI: Record<string, string> = {
  fox: '🦊',
  owl: '🦉',
  wolf: '🐺',
  raven: '🐦‍⬛',
  cat: '🐱',
  bear: '🐻',
  snake: '🐍',
  stag: '🦌',
  hare: '🐰',
  moth: '🦋',
  lynx: '🐈',
  crow: '🐦',
};

export function avatarEmoji(avatar: string): string {
  return AVATAR_EMOJI[avatar] ?? '🎭';
}
