/**
 * AI player personalities and identity pools (Phase 5). Personalities affect
 * dialogue tone and decision bias ONLY — they never bypass the rules or grant
 * access to information the AI's role would not legitimately have.
 */

export type PersonalityId =
  | 'detective'
  | 'bluffer'
  | 'quiet'
  | 'aggressive'
  | 'strategist'
  | 'chaotic';

export interface Personality {
  id: PersonalityId;
  /** Public, human-facing descriptor. */
  label: string;
  /** How talkative in day chat: 0 (rarely) .. 1 (very). */
  chattiness: number;
  /** How strongly they commit to accusations: 0 (hedging) .. 1 (forceful). */
  aggression: number;
  /**
   * Short style hint fed into the (bounded) LLM prompt and used to pick canned
   * fallback lines. Never contains hidden game state.
   */
  stylePrompt: string;
  /** Canned day-chat fallback lines used when the model is slow/unavailable. */
  fallbackLines: string[];
}

export const AI_PERSONALITIES: Record<PersonalityId, Personality> = {
  detective: {
    id: 'detective',
    label: 'The Analyst',
    chattiness: 0.7,
    aggression: 0.5,
    stylePrompt:
      'analytical and evidence-focused; reasons out loud about behavior and timing',
    fallbackLines: [
      'Let us reason this through. Who has been too quiet?',
      'The timing of that last vote bothers me.',
      'I want to hear everyone account for themselves.',
    ],
  },
  bluffer: {
    id: 'bluffer',
    label: 'The Bluffer',
    chattiness: 0.8,
    aggression: 0.4,
    stylePrompt:
      'persuasive and evasive; deflects suspicion smoothly and sows doubt',
    fallbackLines: [
      'Trust me, I am the last person you should worry about.',
      'Funny how the loudest accuser is often the guilty one.',
      'I have a good feeling about most of us here. Mostly.',
    ],
  },
  quiet: {
    id: 'quiet',
    label: 'The Quiet One',
    chattiness: 0.25,
    aggression: 0.3,
    stylePrompt:
      'reserved; contributes little but makes the occasional sharp observation',
    fallbackLines: [
      'I have been watching. Not everything adds up.',
      '...I will keep my vote for now.',
      'Someone here is lying. I am just not sure who yet.',
    ],
  },
  aggressive: {
    id: 'aggressive',
    label: 'The Accuser',
    chattiness: 0.85,
    aggression: 0.9,
    stylePrompt:
      'confrontational; challenges suspicious behavior and pushes hard for a vote',
    fallbackLines: [
      'I do not buy it. You are acting guilty.',
      'Enough talk. We need to vote someone out now.',
      'You have dodged every question. That is suspicious.',
    ],
  },
  strategist: {
    id: 'strategist',
    label: 'The Strategist',
    chattiness: 0.6,
    aggression: 0.6,
    stylePrompt:
      'calculating; weighs voting patterns and alliances before committing',
    fallbackLines: [
      'Look at who voted together last round. That is our thread.',
      'We should not waste a vote. Let us be deliberate.',
      'Patterns do not lie, even when people do.',
    ],
  },
  chaotic: {
    id: 'chaotic',
    label: 'The Wildcard',
    chattiness: 0.7,
    aggression: 0.7,
    stylePrompt:
      'unpredictable but rule-compliant; makes surprising but plausible arguments',
    fallbackLines: [
      'What if the quiet ones are working together? Just saying.',
      'I vote on vibes, and the vibes are off.',
      'Plot twist: it is always the one you least suspect.',
    ],
  },
};

export const PERSONALITY_IDS = Object.keys(AI_PERSONALITIES) as PersonalityId[];

/** Fun bot display names. The UI also shows an AI badge. */
export const AI_NAMES = [
  'Vera', 'Cipher', 'Moira', 'Dex', 'Juno', 'Sable', 'Rook', 'Nyx',
  'Tati', 'Orin', 'Wren', 'Cass', 'Bax', 'Lumen', 'Pia', 'Quill',
];

export function personalityById(id: string | undefined): Personality {
  return AI_PERSONALITIES[(id as PersonalityId) ?? 'strategist'] ??
    AI_PERSONALITIES.strategist;
}
