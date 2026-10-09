'use client';

import { motion } from 'framer-motion';
import type { PublicPlayer } from '@ai-mafia/shared';
import { ConnectionStatus, PlayerKind } from '@ai-mafia/shared';
import { Avatar } from './Avatar';

interface Props {
  player: PublicPlayer;
  isSelf: boolean;
}

export function PlayerCard({ player, isSelf }: Props) {
  const disconnected = player.connection === ConnectionStatus.Disconnected;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`relative flex items-center gap-3 rounded-2xl border p-3 backdrop-blur-sm ${
        isSelf
          ? 'border-violet-electric/50 bg-violet-electric/10'
          : 'border-white/10 bg-charcoal-800/60'
      } ${disconnected ? 'opacity-50' : ''}`}
    >
      <Avatar
        avatar={player.avatar}
        ring={player.isReady ? 'violet' : 'dim'}
        size={44}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-slate-100">
            {player.displayName}
          </span>
          {player.kind === PlayerKind.Ai && (
            <span className="rounded bg-cool-blue/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cool-blue">
              AI
            </span>
          )}
          {isSelf && (
            <span className="text-[10px] uppercase tracking-wider text-violet-glow">
              you
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs">
          {player.isHost && (
            <span className="text-amber-300">★ Host</span>
          )}
          {disconnected ? (
            <span className="text-crimson-glow">disconnected…</span>
          ) : player.isReady ? (
            <span className="text-emerald-300">ready</span>
          ) : (
            <span className="text-slate-500">not ready</span>
          )}
        </div>
      </div>
      {player.isReady && !disconnected && (
        <span className="absolute right-3 top-3 text-emerald-400">✓</span>
      )}
    </motion.div>
  );
}
