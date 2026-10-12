'use client';

import { useEffect, useState } from 'react';

/** Counts down to a server-provided deadline (epoch ms). Server is source of truth. */
export function PhaseTimer({ endsAt }: { endsAt: number | null }) {
  const [remaining, setRemaining] = useState<number>(() =>
    endsAt ? Math.max(0, endsAt - Date.now()) : 0,
  );

  useEffect(() => {
    if (!endsAt) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, endsAt - Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  if (!endsAt) return null;
  const seconds = Math.ceil(remaining / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  const urgent = seconds <= 10;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-sm tabular-nums ${
        urgent
          ? 'border-crimson/50 bg-crimson/10 text-crimson-glow'
          : 'border-white/10 bg-black/30 text-slate-300'
      }`}
      aria-live="polite"
    >
      ⏱ {mm}:{ss.toString().padStart(2, '0')}
    </span>
  );
}
