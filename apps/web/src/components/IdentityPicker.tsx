'use client';

import { useState } from 'react';
import { AVATARS, DISPLAY_NAME_MAX, DISPLAY_NAME_MIN } from '@ai-mafia/shared';
import { Avatar } from './Avatar';
import { Button } from './Button';

interface Props {
  initialName?: string;
  initialAvatar?: string;
  submitLabel: string;
  loading?: boolean;
  onSubmit: (name: string, avatar: string) => void;
}

/** Shared name + avatar picker used by create and join flows. */
export function IdentityPicker({
  initialName = '',
  initialAvatar = AVATARS[0],
  submitLabel,
  loading,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState(initialAvatar);

  const valid =
    name.trim().length >= DISPLAY_NAME_MIN &&
    name.trim().length <= DISPLAY_NAME_MAX;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(name.trim(), avatar);
      }}
    >
      <div>
        <label className="mb-1.5 block text-xs uppercase tracking-wider text-slate-400">
          Display name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          placeholder="e.g. Nightshade"
          autoFocus
          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-600 focus:border-violet-electric/60 focus:ring-2 focus:ring-violet-electric/30"
        />
      </div>

      <div>
        <label className="mb-2 block text-xs uppercase tracking-wider text-slate-400">
          Choose your mask
        </label>
        <div className="grid grid-cols-6 gap-2">
          {AVATARS.map((a) => (
            <button
              type="button"
              key={a}
              onClick={() => setAvatar(a)}
              className={`flex items-center justify-center rounded-xl p-1.5 transition ${
                a === avatar
                  ? 'bg-violet-electric/20 ring-2 ring-violet-electric'
                  : 'bg-charcoal-800/60 ring-1 ring-white/5 hover:bg-charcoal-700'
              }`}
              aria-pressed={a === avatar}
              aria-label={a}
            >
              <Avatar avatar={a} ring="none" size={34} />
            </button>
          ))}
        </div>
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!valid}
        loading={loading}
      >
        {submitLabel}
      </Button>
    </form>
  );
}
