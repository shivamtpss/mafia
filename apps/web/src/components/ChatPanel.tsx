'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@ai-mafia/shared';
import { CHAT_MAX_LENGTH } from '@ai-mafia/shared';

interface Props {
  messages: ChatMessage[];
  selfId: string | null;
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatPanel({
  messages,
  selfId,
  onSend,
  disabled,
  placeholder = 'Say something…',
}: Props) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-600">
            No messages yet. Break the silence.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.system ? 'text-center' : ''}>
              {m.system ? (
                <span className="inline-block rounded-full bg-white/5 px-3 py-1 text-xs italic text-slate-400">
                  {m.text}
                </span>
              ) : (
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.authorId === selfId
                      ? 'ml-auto bg-violet-electric/20 text-slate-100'
                      : 'bg-charcoal-800/80 text-slate-200'
                  }`}
                >
                  <span className="mb-0.5 block text-[11px] font-semibold text-violet-glow">
                    {m.authorName}
                  </span>
                  <span className="break-words">{m.text}</span>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t || disabled) return;
          onSend(t);
          setText('');
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-violet-electric/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="rounded-xl bg-violet-electric px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
