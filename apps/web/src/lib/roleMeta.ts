import { Role } from '@ai-mafia/shared';

export interface RoleMeta {
  label: string;
  emoji: string;
  tone: 'crimson' | 'blue' | 'violet' | 'slate';
  tagline: string;
  nightPrompt?: string;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  [Role.Mafia]: {
    label: 'Mafia',
    emoji: '🔪',
    tone: 'crimson',
    tagline: 'Eliminate the town without being caught.',
    nightPrompt: 'Choose someone to eliminate tonight.',
  },
  [Role.Detective]: {
    label: 'Detective',
    emoji: '🔍',
    tone: 'blue',
    tagline: 'Investigate one player each night to find the Mafia.',
    nightPrompt: 'Choose someone to investigate.',
  },
  [Role.Doctor]: {
    label: 'Doctor',
    emoji: '🩺',
    tone: 'violet',
    tagline: 'Protect one player each night from the Mafia.',
    nightPrompt: 'Choose someone to protect.',
  },
  [Role.Townsperson]: {
    label: 'Townsperson',
    emoji: '🧑‍🌾',
    tone: 'slate',
    tagline: 'Find and vote out the Mafia with your wits.',
  },
};

export const TONE_CLASSES: Record<RoleMeta['tone'], string> = {
  crimson: 'text-crimson-glow border-crimson/40 bg-crimson/10',
  blue: 'text-cool-blue border-cool-blue/40 bg-cool-blue/10',
  violet: 'text-violet-glow border-violet-electric/40 bg-violet-electric/10',
  slate: 'text-slate-300 border-white/15 bg-white/5',
};
