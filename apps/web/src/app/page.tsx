'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/Button';

const FEATURES = [
  { icon: '🎭', title: 'Secret roles', text: 'Townsperson, Detective, Doctor, Mafia. Trust no one.' },
  { icon: '⚡', title: 'Real-time', text: 'Server-authoritative Socket.IO. No cheating.' },
  { icon: '🤖', title: 'AI opponents', text: 'Fill empty seats with distinct AI personalities.' },
  { icon: '🏆', title: 'Progression', text: 'Earn XP, climb leaderboards, unlock cosmetics.' },
];

export default function LandingPage() {
  return (
    <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-16 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <span className="mb-4 inline-block rounded-full border border-crimson/40 bg-crimson/10 px-4 py-1 text-xs uppercase tracking-[0.2em] text-crimson-glow">
          Social Deduction
        </span>
        <h1 className="bg-gradient-to-b from-white to-slate-400 bg-clip-text text-6xl font-bold tracking-tight text-transparent sm:text-7xl">
          AI MAFIA
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-400">
          A cinematic multiplayer game of lies, logic, and survival. Discuss,
          deduce, and vote. Will the Town root out the Mafia, or will the city
          fall to shadow?
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="mt-10 flex flex-col gap-3 sm:flex-row"
      >
        <Link href="/play">
          <Button size="lg" className="w-full sm:w-auto">
            Play Now
          </Button>
        </Link>
        <Link href="/play?mode=join">
          <Button size="lg" variant="secondary" className="w-full sm:w-auto">
            Join with code
          </Button>
        </Link>
      </motion.div>

      <div className="mt-20 grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 + i * 0.08 }}
            className="rounded-2xl border border-white/10 bg-charcoal-800/50 p-5 text-left backdrop-blur-sm"
          >
            <div className="mb-3 text-3xl">{f.icon}</div>
            <h3 className="font-semibold text-slate-100">{f.title}</h3>
            <p className="mt-1 text-sm text-slate-400">{f.text}</p>
          </motion.div>
        ))}
      </div>

      <footer className="mt-20 text-xs text-slate-600">
        Built with Next.js, NestJS, Socket.IO & Ollama · Phase 1: Playable lobby
      </footer>
    </main>
  );
}
