/**
 * Narrative themes and scenario schema (Phase 4). Themes carry static fallback
 * flavor so the game is fully playable even when Ollama is slow or unavailable.
 * AI-generated scenario text is validated against this schema before use and is
 * ALWAYS kept separate from trusted game commands.
 */

import { Role } from './types';

/** Per-theme cosmetic display for a role (mechanics are unchanged). */
export interface ThemeRoleDisplay {
  label: string;
  emoji: string;
}

export interface ThemeDef {
  id: string;
  name: string;
  /** Short premise shown in the lobby. */
  blurb: string;
  /** What the "Mafia" faction is called in this theme (cosmetic only). */
  villainName: string;
  /** What the "Town" faction is called in this theme (cosmetic only). */
  townName: string;
  /**
   * Cosmetic role names + emoji for this theme. The underlying Role enum and all
   * mechanics are identical across themes; only these labels/emoji change.
   */
  roles: Record<Role, ThemeRoleDisplay>;
  /** Static fallback narration used when AI is unavailable. */
  fallback: {
    intro: string;
    night: string;
    day: string;
    voting: string;
    townWin: string;
    mafiaWin: string;
  };
}

export const THEMES: ThemeDef[] = [
  {
    id: 'haunted-village',
    name: 'The Haunted Village',
    blurb: 'A fog-bound hamlet where something wears a human face after dark.',
    villainName: 'the Cursed',
    townName: 'Villagers',
    roles: {
      [Role.Townsperson]: { label: 'Villager', emoji: '\uD83E\uDDD1\u200D\uD83C\uDF3E' },
      [Role.Detective]: { label: 'Seer', emoji: '\uD83D\uDD2E' },
      [Role.Doctor]: { label: 'Herbalist', emoji: '\uD83C\uDF3F' },
      [Role.Mafia]: { label: 'Cursed', emoji: '\uD83D\uDC7B' },
    },
    fallback: {
      intro:
        'Lanterns gutter in the mist. The villagers gather, unaware that something old has woken among them.',
      night:
        'The village sleeps uneasily. In the dark, the Cursed choose their prey.',
      day: 'Grey dawn reveals the night\u2019s work. The villagers must decide who is not what they seem.',
      voting: 'Fingers point in the firelight. A name must be spoken.',
      townWin: 'The last curse is broken. Dawn comes clean over the village at last.',
      mafiaWin: 'The fog never lifts. The village belongs to the Cursed now.',
    },
  },
  {
    id: 'cyberpunk-city',
    name: 'Neon Syndicate',
    blurb: 'In a rain-slick megacity, rogue AIs hide inside the crew.',
    villainName: 'the Syndicate',
    townName: 'the Crew',
    roles: {
      [Role.Townsperson]: { label: 'Operator', emoji: '\uD83E\uDDD1\u200D\uD83D\uDCBB' },
      [Role.Detective]: { label: 'Netrunner', emoji: '\uD83D\uDD79\uFE0F' },
      [Role.Doctor]: { label: 'Medtech', emoji: '\uD83D\uDC89' },
      [Role.Mafia]: { label: 'Syndicate', emoji: '\uD83D\uDC7E' },
    },
    fallback: {
      intro:
        'Neon bleeds across wet chrome. Somewhere in the crew, the Syndicate\u2019s ghosts are already running code.',
      night: 'The city hums. In the dark net, the Syndicate marks a target.',
      day: 'Morning static clears. The crew sifts the logs for a traitor.',
      voting: 'Accusations spike across the channel. Lock in a name.',
      townWin: 'The Syndicate is purged from the net. The crew breathes clean air.',
      mafiaWin: 'The Syndicate owns every node now. The crew flatlines.',
    },
  },
  {
    id: 'space-station',
    name: 'Orbital Blackout',
    blurb: 'Aboard a failing station, an impostor walks the corridors.',
    villainName: 'the Impostors',
    townName: 'the Crew',
    roles: {
      [Role.Townsperson]: { label: 'Crewmate', emoji: '\uD83E\uDDD1\u200D\uD83D\uDE80' },
      [Role.Detective]: { label: 'Security', emoji: '\uD83D\uDEF0\uFE0F' },
      [Role.Doctor]: { label: 'Medic', emoji: '\uD83E\uDE7A' },
      [Role.Mafia]: { label: 'Impostor', emoji: '\uD83D\uDC7D' },
    },
    fallback: {
      intro:
        'Alarms whisper through the hull. The crew is not alone aboard the station.',
      night: 'Lights dim to conserve power. In the dark decks, the Impostors strike.',
      day: 'Life support stabilizes for now. The crew compares alibis.',
      voting: 'The airlock waits. Choose who to vent.',
      townWin: 'The last Impostor is spaced. The crew limps home.',
      mafiaWin: 'The crew is gone. The station drifts, silent and claimed.',
    },
  },
  {
    id: 'medieval-kingdom',
    name: 'The King\u2019s Betrayal',
    blurb: 'Traitors move through a candlelit court, loyal to a hidden crown.',
    villainName: 'the Conspiracy',
    townName: 'the Court',
    roles: {
      [Role.Townsperson]: { label: 'Courtier', emoji: '\uD83E\uDDD1\u200D\uD83C\uDF3E' },
      [Role.Detective]: { label: 'Royal Spymaster', emoji: '\uD83D\uDD0E' },
      [Role.Doctor]: { label: 'Court Physician', emoji: '\u2697\uFE0F' },
      [Role.Mafia]: { label: 'Conspirator', emoji: '\uD83D\uDDE1\uFE0F' },
    },
    fallback: {
      intro:
        'Candlelight flickers on the throne. Among the loyal court, a conspiracy already turns.',
      night: 'The castle sleeps. In shadowed halls, the Conspiracy acts.',
      day: 'Bells ring at daybreak. The court seeks the hidden hand.',
      voting: 'The court demands justice. Name the traitor.',
      townWin: 'The conspiracy falls. The realm is loyal once more.',
      mafiaWin: 'The crown is seized in blood. The Conspiracy rules.',
    },
  },
];

export const DEFAULT_THEME_ID = THEMES[0].id;

export function getTheme(id: string | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Cosmetic display (label + emoji) for a role within a theme. */
export function themeRole(
  themeId: string | undefined,
  role: Role,
): ThemeRoleDisplay {
  return getTheme(themeId).roles[role];
}

// ---------------------------------------------------------------------------
// Scenario schema (AI-generated, validated before use)
// ---------------------------------------------------------------------------

/** A generated, validated scenario attached to a game for flavor. */
export interface Scenario {
  themeId: string;
  title: string;
  intro: string;
  /** Optional per-character flavor names keyed by player id (cosmetic). */
  characters?: Array<{ name: string; bio: string }>;
}

export const SCENARIO_TITLE_MAX = 80;
export const SCENARIO_INTRO_MAX = 600;
export const NARRATION_MAX = 400;

/**
 * Validate and sanitize an AI scenario payload. Returns a clean Scenario or null
 * if the payload does not satisfy the schema. Never throws.
 */
export function validateScenario(raw: unknown, themeId: string): Scenario | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const title = cleanText(obj.title, SCENARIO_TITLE_MAX);
  const intro = cleanText(obj.intro, SCENARIO_INTRO_MAX);
  if (!title || !intro) return null;

  let characters: Scenario['characters'] | undefined;
  if (Array.isArray(obj.characters)) {
    characters = [];
    for (const c of obj.characters.slice(0, 12)) {
      if (!c || typeof c !== 'object') continue;
      const cc = c as Record<string, unknown>;
      const name = cleanText(cc.name, 40);
      const bio = cleanText(cc.bio, 160);
      if (name && bio) characters.push({ name, bio });
    }
    if (characters.length === 0) characters = undefined;
  }

  return { themeId, title, intro, characters };
}

/** Validate a single narration line. Returns clean text or null. */
export function validateNarration(raw: unknown): string | null {
  if (typeof raw === 'string') {
    return cleanText(raw, NARRATION_MAX) || null;
  }
  if (raw && typeof raw === 'object') {
    const line = (raw as Record<string, unknown>).line;
    return cleanText(line, NARRATION_MAX) || null;
  }
  return null;
}

/** Strip control chars / collapse whitespace / enforce a max length. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, max);
}
