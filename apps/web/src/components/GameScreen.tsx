'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  GamePhase,
  PlayerStatus,
  Role,
  Team,
  type PublicPlayer,
} from '@ai-mafia/shared';
import type { RoomClient } from '@/lib/useRoomClient';
import { ROLE_META, TONE_CLASSES } from '@/lib/roleMeta';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { ChatPanel } from './ChatPanel';
import { PhaseTimer } from './PhaseTimer';

const PHASE_LABEL: Record<string, string> = {
  [GamePhase.RoleReveal]: 'Role Reveal',
  [GamePhase.Night]: 'Night',
  [GamePhase.Day]: 'Day',
  [GamePhase.Voting]: 'Voting',
  [GamePhase.Elimination]: 'Resolution',
  [GamePhase.GameOver]: 'Game Over',
};

interface Props {
  client: RoomClient;
}

export function GameScreen({ client }: Props) {
  const { room, selfId, role } = client;
  const [selected, setSelected] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [submittedFor, setSubmittedFor] = useState<string | null>(null);

  const self = useMemo(
    () => room?.players.find((p) => p.id === selfId) ?? null,
    [room, selfId],
  );
  const alive = self?.status === PlayerStatus.Alive;

  if (!room) return null;

  const phase = room.phase;
  const isNight = phase === GamePhase.Night;
  const isVoting = phase === GamePhase.Voting;

  // Who the current player may target this phase.
  const canActNight =
    isNight &&
    alive &&
    role != null &&
    role.role !== Role.Townsperson;
  const canVote = isVoting && alive;

  function selectableFor(target: PublicPlayer): boolean {
    if (target.status !== PlayerStatus.Alive) return false;
    if (canActNight) {
      // Mafia can't target fellow mafia or self; detective can't self-target.
      if (role?.role === Role.Mafia) {
        if (target.id === selfId) return false;
        if (role.allies?.includes(target.id)) return false;
      }
      if (role?.role === Role.Detective && target.id === selfId) return false;
      return true;
    }
    if (canVote) return true; // may vote anyone alive (self-vote allowed as protest)
    return false;
  }

  async function confirmSelection() {
    if (!selected) return;
    setActionNote(null);
    if (canActNight) {
      const res = await client.submitNightAction(selected);
      if (res.ok) {
        setSubmittedFor(selected);
        setActionNote('Your action was submitted.');
      } else setActionNote(res.message);
    } else if (canVote) {
      const res = await client.castVote(selected);
      if (res.ok) {
        setSubmittedFor(selected);
        setActionNote('Your vote was cast.');
      } else setActionNote(res.message);
    }
  }

  const roleMeta = role ? ROLE_META[role.role] : null;
  const allies =
    role?.role === Role.Mafia && role.allies
      ? room.players.filter((p) => role.allies!.includes(p.id))
      : [];

  // Results screen.
  if (phase === GamePhase.GameOver && client.finished) {
    return <Results client={client} />;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <section className="space-y-4">
        {/* Phase banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-charcoal-900/60 px-5 py-3">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-500">
              Round {room.round}
            </div>
            <div
              className="font-display text-2xl text-slate-100"
              data-testid="phase-label"
            >
              {PHASE_LABEL[phase] ?? phase}
            </div>
          </div>
          <PhaseTimer endsAt={room.phaseEndsAt} />
        </div>

        {/* Narration */}
        {client.lastPhaseEvent?.announcement && (
          <motion.p
            key={client.lastPhaseEvent.phase + client.lastPhaseEvent.round}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm italic text-slate-400"
          >
            {client.lastPhaseEvent.announcement}
          </motion.p>
        )}

        {/* Role card */}
        {roleMeta && (
          <div
            className={`flex items-center gap-4 rounded-2xl border p-4 ${TONE_CLASSES[roleMeta.tone]}`}
          >
            <div className="text-4xl">{roleMeta.emoji}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold" data-testid="role-label">
                  {roleMeta.label}
                </span>
                <span className="text-xs opacity-70">
                  · {role!.team === Team.Mafia ? 'Mafia' : 'Town'}
                </span>
                {!alive && (
                  <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                    eliminated
                  </span>
                )}
              </div>
              <p className="text-sm opacity-80">{roleMeta.tagline}</p>
              {allies.length > 0 && (
                <p className="mt-1 text-xs opacity-80">
                  Allies: {allies.map((a) => a.displayName).join(', ')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Investigation results (detective only) */}
        {client.investigations.length > 0 && (
          <div className="rounded-2xl border border-cool-blue/30 bg-cool-blue/5 p-4">
            <div className="mb-2 text-xs uppercase tracking-wider text-cool-blue">
              Investigation findings
            </div>
            <ul className="space-y-1 text-sm text-slate-300">
              {client.investigations.map((inv, i) => {
                const target = room.players.find((p) => p.id === inv.targetId);
                return (
                  <li key={i}>
                    Night {inv.round}: {target?.displayName ?? 'Unknown'} is{' '}
                    <span
                      className={
                        inv.result === 'MAFIA'
                          ? 'font-semibold text-crimson-glow'
                          : 'font-semibold text-emerald-300'
                      }
                    >
                      {inv.result === 'MAFIA' ? 'MAFIA' : 'not Mafia'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Player grid */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-slate-200">Players</h3>
            {(canActNight || canVote) && (
              <span className="text-xs text-slate-500">
                {canActNight ? roleMeta?.nightPrompt : 'Select who to vote out'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {room.players.map((p) => {
              const dead = p.status === PlayerStatus.Dead;
              const selectable = selectableFor(p);
              const isSelected = selected === p.id;
              const voteCount =
                isVoting && client.tally
                  ? client.tally.counts[p.id] ?? 0
                  : 0;
              return (
                <button
                  key={p.id}
                  disabled={!selectable}
                  onClick={() => setSelected(p.id)}
                  data-testid={`player-${p.displayName}`}
                  data-selectable={selectable ? 'true' : 'false'}
                  className={`relative flex flex-col items-center gap-2 rounded-2xl border p-3 transition ${
                    isSelected
                      ? 'border-violet-electric bg-violet-electric/15'
                      : selectable
                        ? 'border-white/10 bg-charcoal-800/60 hover:border-violet-electric/50'
                        : 'border-white/5 bg-charcoal-900/40'
                  } ${dead ? 'opacity-40 grayscale' : ''}`}
                >
                  <Avatar avatar={p.avatar} size={42} ring={isSelected ? 'violet' : 'dim'} />
                  <span className="max-w-full truncate text-sm text-slate-200">
                    {p.displayName}
                    {p.id === selfId && (
                      <span className="ml-1 text-[10px] text-violet-glow">you</span>
                    )}
                  </span>
                  {dead && (
                    <span className="absolute right-2 top-2 text-sm">💀</span>
                  )}
                  {isVoting && voteCount > 0 && (
                    <span className="absolute left-2 top-2 rounded-full bg-crimson/30 px-1.5 text-xs text-crimson-glow">
                      {voteCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {(canActNight || canVote) && (
            <div className="mt-4 flex items-center gap-3">
              <Button
                onClick={confirmSelection}
                disabled={!selected}
                variant={canVote ? 'danger' : 'primary'}
              >
                {canActNight ? 'Confirm action' : 'Confirm vote'}
              </Button>
              {canActNight && (
                <button
                  onClick={async () => {
                    const res = await client.submitNightAction(null);
                    if (res.ok) setActionNote('You chose to skip.');
                    else setActionNote(res.message);
                  }}
                  className="text-sm text-slate-500 hover:text-slate-300"
                >
                  Skip
                </button>
              )}
              {canVote && (
                <button
                  onClick={async () => {
                    const res = await client.castVote(null);
                    if (res.ok) setActionNote('You abstained.');
                    else setActionNote(res.message);
                  }}
                  className="text-sm text-slate-500 hover:text-slate-300"
                >
                  Abstain
                </button>
              )}
              {submittedFor && (
                <span className="text-xs text-emerald-300">✓ submitted</span>
              )}
            </div>
          )}

          {!alive && phase !== GamePhase.GameOver && (
            <p className="mt-4 rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-center text-sm text-slate-400">
              You have been eliminated. You can still watch, but cannot act or vote.
            </p>
          )}

          {actionNote && (
            <p className="mt-3 text-center text-sm text-violet-glow">{actionNote}</p>
          )}
        </div>
      </section>

      {/* Chat */}
      <section className="flex h-[34rem] flex-col rounded-3xl border border-white/10 bg-charcoal-900/50 p-5 backdrop-blur-md">
        <h3 className="mb-3 font-semibold text-slate-200">
          {isNight ? 'Town is asleep' : 'Discussion'}
        </h3>
        <div className="min-h-0 flex-1">
          <ChatPanel
            messages={client.messages}
            selfId={selfId}
            onSend={(t) => client.sendChat(t)}
            disabled={client.conn !== 'connected' || !alive || isNight}
            placeholder={
              isNight
                ? 'The town is asleep. Chat resumes at dawn.'
                : alive
                  ? 'Share your suspicions…'
                  : 'Eliminated players cannot chat.'
            }
          />
        </div>
      </section>
    </div>
  );
}

function Results({ client }: { client: RoomClient }) {
  const { room, selfId, finished } = client;
  if (!room || !finished) return null;
  const self = room.players.find((p) => p.id === selfId);
  const selfRole = finished.roles.find((r) => r.playerId === selfId);
  const won =
    selfRole != null && selfRole.team === finished.winningTeam;
  const isHost = self?.isHost ?? false;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mx-auto max-w-2xl space-y-6 text-center"
    >
      <div
        className={`rounded-3xl border p-8 ${
          finished.winningTeam === Team.Mafia
            ? 'border-crimson/40 bg-crimson/10'
            : 'border-cool-blue/40 bg-cool-blue/10'
        }`}
      >
        <div className="text-5xl">
          {finished.winningTeam === Team.Mafia ? '🔪' : '🏆'}
        </div>
        <h2 className="mt-3 font-display text-3xl text-slate-100">
          {finished.winningTeam === Team.Mafia ? 'Mafia Win' : 'Town Wins'}
        </h2>
        <p className="mt-2 text-slate-400">{finished.summary}</p>
        {selfRole && (
          <p className="mt-3 text-sm">
            You were the{' '}
            <span className="font-semibold text-slate-200">
              {ROLE_META[selfRole.role as Role].label}
            </span>{' '}
            ·{' '}
            <span className={won ? 'text-emerald-300' : 'text-crimson-glow'}>
              {won ? 'Victory' : 'Defeat'}
            </span>
          </p>
        )}
      </div>

      {/* Full reveal */}
      <div className="rounded-3xl border border-white/10 bg-charcoal-900/50 p-5 text-left">
        <h3 className="mb-3 font-semibold text-slate-200">Final roles</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {finished.roles.map((r) => {
            const p = room.players.find((pp) => pp.id === r.playerId);
            const meta = ROLE_META[r.role as Role];
            return (
              <div
                key={r.playerId}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-2.5"
              >
                <Avatar avatar={p?.avatar ?? 'fox'} size={36} ring="none" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">
                    {p?.displayName ?? 'Unknown'}
                  </div>
                  <div
                    className={
                      r.team === Team.Mafia
                        ? 'text-xs text-crimson-glow'
                        : 'text-xs text-cool-blue'
                    }
                  >
                    {meta.emoji} {meta.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isHost ? (
        <Button size="lg" onClick={() => client.rematch()}>
          Play again
        </Button>
      ) : (
        <p className="text-sm text-slate-500">
          Waiting for the host to start a rematch…
        </p>
      )}
    </motion.div>
  );
}
