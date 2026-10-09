'use client';

import { avatarEmoji } from '@/lib/avatars';

interface Props {
  avatar: string;
  size?: number;
  ring?: 'none' | 'violet' | 'crimson' | 'dim';
  className?: string;
}

const rings: Record<NonNullable<Props['ring']>, string> = {
  none: 'ring-0',
  violet: 'ring-2 ring-violet-electric/70 shadow-glow',
  crimson: 'ring-2 ring-crimson-glow/70 shadow-glow-crimson',
  dim: 'ring-1 ring-white/10',
};

export function Avatar({ avatar, size = 44, ring = 'dim', className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-charcoal-800 ${rings[ring]} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      role="img"
      aria-label={avatar}
    >
      {avatarEmoji(avatar)}
    </span>
  );
}
