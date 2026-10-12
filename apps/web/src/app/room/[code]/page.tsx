'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { GamePhase } from '@ai-mafia/shared';
import { useRoomClient } from '@/lib/useRoomClient';
import { loadIdentity } from '@/lib/identity';
import { PlayerCard } from '@/components/PlayerCard';
import { ChatPanel } from '@/components/ChatPanel';
import { ConnectionBadge } from '@/components/ConnectionBadge';
import { GameScreen } from '@/components/GameScreen';
import { Button } from '@/components/Button';

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params?.code ?? '').toUpperCase();
  const client = useRoomClient();

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  // On mount (and reconnect), reclaim our seat by session, else bounce to /play.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const id = loadIdentity();
      if (!id?.sessionId) {
        router.replace(`/play?mode=join&code=${code}`);
        return;
      }
      const res = await client.rejoin(code);
      if (cancelled) return;
      if (res.ok) {
        setStatus('ready');
      } else {
        setErrorMsg(res.message);
        setStatus('error');
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, client.conn === 'connected']);

  const room = client.room;
  const self = useMemo(
    () => room?.players.find((p) => p.id === client.selfId) ?? null,
    [room, client.selfId],
  );
  const isHost = self?.isHost ?? false;

  const readyCount = room?.players.filter((p) => p.isReady || p.isHost).length ?? 0;
  const canStart =
    room != null &&
    room.players.length >= room.settings.minPlayers &&
    room.players.every((p) => p.isReady || p.isHost);

  async function toggleReady() {
    if (!self) return;
    setActionError(null);
    const res = await client.setReady(!self.isReady);
    if (!res.ok) setActionError(res.message);
  }

  async function handleStart() {
    setStarting(true);
    setActionError(null);
    const res = await client.startGame();
    setStarting(false);
    if (!res.ok) setActionError(res.message);
  }

  async function copyInvite() {
    const url = `${window.location.origin}/play?mode=join&code=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  }

  async function handleLeave() {
    await client.leaveRoom();
    router.push('/');
  }

  if (status === 'loading') {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-4">
          <span className="h-10 w-10 animate-spin rounded-full border-2 border-violet-electric/30 border-t-violet-electric" />
          <p className="text-slate-400">Entering room {code}…</p>
        </div>
      </Centered>
    );
  }

  if (status === 'error') {
    return (
      <Centered>
        <div className="max-w-sm rounded-3xl border border-crimson/30 bg-charcoal-900/70 p-8 text-center">
          <div className="mb-3 text-4xl">🚫</div>
          <h2 className="text-xl font-semibold text-slate-100">
            Can&apos;t enter room
          </h2>
          <p className="mt-2 text-sm text-slate-400">{errorMsg}</p>
          <Button className="mt-5" onClick={() => router.push('/play')}>
            Back to menu
          </Button>
        </div>
      </Centered>
    );
  }

  const inGame = room && room.phase !== GamePhase.Lobby;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={handleLeave}
            className="text-sm text-slate-500 transition hover:text-slate-300"
          >
            ← Leave
          </button>
          <div>
            <h1 className="font-display text-lg font-semibold tracking-wide text-slate-100">
              Room
            </h1>
          </div>
          <button
            onClick={copyInvite}
            className="group flex items-center gap-2 rounded-xl border border-violet-electric/30 bg-violet-electric/10 px-3 py-1.5 transition hover:bg-violet-electric/20"
            title="Click to copy invite link"
          >
            <span className="text-2xl font-bold tracking-[0.3em] text-violet-glow">
              {code}
            </span>
            <span className="text-xs text-slate-400 group-hover:text-slate-200">
              {copied ? 'copied!' : 'copy invite'}
            </span>
          </button>
        </div>
        <ConnectionBadge conn={client.conn} />
      </div>

      {client.conn === 'disconnected' && (
        <div className="mb-4 rounded-xl border border-crimson/40 bg-crimson/10 px-4 py-2.5 text-sm text-crimson-glow">
          Connection lost. Attempting to reconnect… your seat is held for 60s.
        </div>
      )}

      {inGame ? (
        <GameScreen client={client} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Players + controls */}
          <section className="rounded-3xl border border-white/10 bg-charcoal-900/50 p-5 backdrop-blur-md">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-200">
                Players{' '}
                <span className="text-slate-500">
                  {room?.players.length}/{room?.settings.maxPlayers}
                </span>
              </h2>
              <span className="text-xs text-slate-500">
                {readyCount}/{room?.players.length} ready · min{' '}
                {room?.settings.minPlayers}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <AnimatePresence mode="popLayout">
                {room?.players.map((p) => (
                  <PlayerCard key={p.id} player={p} isSelf={p.id === client.selfId} />
                ))}
              </AnimatePresence>
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  variant={self?.isReady ? 'secondary' : 'primary'}
                  className="flex-1"
                  onClick={toggleReady}
                >
                  {self?.isReady ? 'Not ready' : "I'm ready"}
                </Button>
                {isHost && (
                  <Button
                    variant="danger"
                    className="flex-1"
                    disabled={!canStart}
                    loading={starting}
                    onClick={handleStart}
                  >
                    Start game
                  </Button>
                )}
              </div>
              {isHost && !canStart && (
                <p className="text-center text-xs text-slate-500">
                  Need at least {room?.settings.minPlayers} players, all ready, to
                  start.
                </p>
              )}
              {!isHost && (
                <p className="text-center text-xs text-slate-500">
                  Waiting for the host to start the game…
                </p>
              )}
            </div>

            {actionError && (
              <p className="mt-4 rounded-xl border border-crimson/40 bg-crimson/10 px-4 py-2.5 text-center text-sm text-crimson-glow">
                {actionError}
              </p>
            )}
          </section>

          {/* Chat */}
          <section className="flex h-[32rem] flex-col rounded-3xl border border-white/10 bg-charcoal-900/50 p-5 backdrop-blur-md lg:h-auto">
            <h2 className="mb-3 font-semibold text-slate-200">Lobby chat</h2>
            <div className="min-h-0 flex-1">
              <ChatPanel
                messages={client.messages}
                selfId={client.selfId}
                onSend={(t) => client.sendChat(t)}
                disabled={client.conn !== 'connected'}
              />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      {children}
    </main>
  );
}
