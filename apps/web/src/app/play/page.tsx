'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { normalizeRoomCode } from '@ai-mafia/shared';
import { IdentityPicker } from '@/components/IdentityPicker';
import { Button } from '@/components/Button';
import { loadIdentity, randomAvatar } from '@/lib/identity';
import { useRoomClient } from '@/lib/useRoomClient';

type Mode = 'menu' | 'create' | 'join';

function PlayInner() {
  const router = useRouter();
  const params = useSearchParams();
  const client = useRoomClient();

  const [mode, setMode] = useState<Mode>(
    params.get('mode') === 'join' ? 'join' : 'menu',
  );
  const [code, setCode] = useState(params.get('code')?.toUpperCase() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialName, setInitialName] = useState('');
  const [initialAvatar, setInitialAvatar] = useState(randomAvatar());

  useEffect(() => {
    const id = loadIdentity();
    if (id) {
      setInitialName(id.displayName);
      setInitialAvatar(id.avatar);
    }
  }, []);

  async function handleCreate(name: string, avatar: string) {
    setBusy(true);
    setError(null);
    const res = await client.createRoom(name, avatar);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    router.push(`/room/${res.data.room.code}`);
  }

  async function handleJoin(name: string, avatar: string) {
    const normalized = normalizeRoomCode(code);
    if (!normalized.ok) return setError(normalized.reason);
    setBusy(true);
    setError(null);
    const res = await client.joinRoom(normalized.value, name, avatar);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    router.push(`/room/${res.data.room.code}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Link
        href="/"
        className="mb-6 text-sm text-slate-500 transition hover:text-slate-300"
      >
        ← Back
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-3xl border border-white/10 bg-charcoal-900/70 p-7 backdrop-blur-md"
      >
        {mode === 'menu' && (
          <div className="space-y-4">
            <h1 className="text-center text-2xl font-semibold text-slate-100">
              Enter the city
            </h1>
            <p className="text-center text-sm text-slate-400">
              Play as a guest. No account required.
            </p>
            <div className="space-y-3 pt-2">
              <Button size="lg" className="w-full" onClick={() => setMode('create')}>
                Create a room
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                onClick={() => setMode('join')}
              >
                Join with a code
              </Button>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <div className="space-y-5">
            <h1 className="text-xl font-semibold text-slate-100">
              Create a room
            </h1>
            <IdentityPicker
              initialName={initialName}
              initialAvatar={initialAvatar}
              submitLabel="Create room"
              loading={busy}
              onSubmit={handleCreate}
            />
            <button
              className="w-full text-sm text-slate-500 hover:text-slate-300"
              onClick={() => setMode('menu')}
            >
              ← choose another option
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className="space-y-5">
            <h1 className="text-xl font-semibold text-slate-100">Join a room</h1>
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wider text-slate-400">
                Room code
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={5}
                placeholder="ABCDE"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center text-2xl font-bold tracking-[0.4em] text-slate-100 outline-none placeholder:text-slate-700 focus:border-violet-electric/60"
              />
            </div>
            <IdentityPicker
              initialName={initialName}
              initialAvatar={initialAvatar}
              submitLabel="Join room"
              loading={busy}
              onSubmit={handleJoin}
            />
            <button
              className="w-full text-sm text-slate-500 hover:text-slate-300"
              onClick={() => setMode('menu')}
            >
              ← choose another option
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-xl border border-crimson/40 bg-crimson/10 px-4 py-2.5 text-center text-sm text-crimson-glow">
            {error}
          </p>
        )}
      </motion.div>
    </main>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="p-10 text-slate-500">Loading…</div>}>
      <PlayInner />
    </Suspense>
  );
}
