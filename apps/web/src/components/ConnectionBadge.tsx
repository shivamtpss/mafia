'use client';

import type { ConnPhase } from '@/lib/useRoomClient';

const MAP: Record<ConnPhase, { label: string; dot: string; text: string }> = {
  idle: { label: 'Idle', dot: 'bg-slate-500', text: 'text-slate-400' },
  connecting: { label: 'Connecting', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300' },
  connected: { label: 'Connected', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300' },
  disconnected: { label: 'Disconnected', dot: 'bg-crimson-glow animate-pulse', text: 'text-crimson-glow' },
};

export function ConnectionBadge({ conn }: { conn: ConnPhase }) {
  const c = MAP[conn];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs ${c.text}`}>
      <span className={`h-2 w-2 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
