import { Injectable, Logger } from '@nestjs/common';
import { Role, personalityById, validateNarration } from '@ai-mafia/shared';
import { GameState } from './game.state';
import { GameEngine } from './game.engine';
import { OllamaClient } from '../ai/ollama.client';

/**
 * Decision brain for AI-controlled players. The two decision methods
 * ({@link decideNightTarget}, {@link decideVote}) are PURE heuristics — no I/O,
 * always legal, role-aware, and personality-biased — so the game never waits on
 * a model to proceed. Only {@link chatLine} touches the LLM, and it is bounded
 * with canned fallbacks.
 *
 * Information boundary: every method takes only the acting AI's own id and the
 * authoritative GameState, and uses GameEngine accessors that respect what that
 * role may legitimately know (mafia see allies; nobody else sees roles).
 */
@Injectable()
export class AiPlayerService {
  private readonly logger = new Logger(AiPlayerService.name);
  private readonly chatTimeoutMs: number;

  constructor(private readonly ollama: OllamaClient) {
    const base = Number(process.env.AI_INFERENCE_TIMEOUT_MS ?? 8000);
    // AI chatter is lowest priority; cap it tighter than narration.
    this.chatTimeoutMs = Math.min(Number.isFinite(base) ? base : 8000, 6000);
  }

  /**
   * Choose a night-action target for an AI actor, or null to skip. Pure and
   * always legal: the result is re-validated by GameEngine.submitNightAction.
   *
   * @param knownMafiaResults optional detective memory: targetId -> isMafia,
   *   representing ONLY this detective's own prior investigation results.
   */
  decideNightTarget(
    game: GameState,
    actorId: string,
    knownMafiaResults?: Map<string, boolean>,
  ): string | null {
    const role = game.roles.get(actorId);
    if (!role) return null;
    const living = [...game.alive];

    switch (role) {
      case Role.Mafia: {
        // Target a living non-mafia, preferring known town power if the AI could
        // infer it (it cannot see roles, so just avoid fellow mafia + self).
        const allies = new Set(GameEngine.mafiaAllies(game, actorId));
        const candidates = living.filter(
          (id) => id !== actorId && !allies.has(id),
        );
        return this.pick(candidates);
      }
      case Role.Doctor: {
        // Protect someone at random, slightly favoring self-preservation.
        if (Math.random() < 0.35) return actorId;
        return this.pick(living);
      }
      case Role.Detective: {
        // Investigate someone not yet investigated and not self.
        const seen = knownMafiaResults ?? new Map<string, boolean>();
        const candidates = living.filter(
          (id) => id !== actorId && !seen.has(id),
        );
        return this.pick(candidates.length ? candidates : living.filter((id) => id !== actorId));
      }
      default:
        return null; // Townsperson has no night action.
    }
  }

  /**
   * Choose a vote target for an AI voter, or null to abstain. Pure, legal, and
   * role/personality-aware:
   *  - Mafia AI avoid voting their allies and prefer to pile on a town target.
   *  - Detective AI vote a player they personally confirmed as Mafia, if any.
   *  - Others use light heuristics biased by personality aggression.
   */
  decideVote(
    game: GameState,
    voterId: string,
    context?: {
      /** Detective's own confirmed results (targetId -> isMafia). */
      knownMafiaResults?: Map<string, boolean>;
      /** Public running tally so AI can pile onto a forming majority. */
      tally?: Record<string, number>;
      personalityId?: string;
    },
  ): string | null {
    const role = game.roles.get(voterId);
    if (!role) return null;
    const living = [...game.alive].filter((id) => id !== voterId);
    if (living.length === 0) return null;

    const persona = personalityById(context?.personalityId);

    // Detective: if they personally confirmed a living mafioso, vote them.
    if (role === Role.Detective && context?.knownMafiaResults) {
      const confirmed = [...context.knownMafiaResults.entries()]
        .filter(([id, isMafia]) => isMafia && game.alive.has(id))
        .map(([id]) => id);
      const pick = this.pick(confirmed);
      if (pick) return pick;
    }

    // Mafia: never vote an ally; prefer piling onto the current town-leaning
    // front-runner to push an elimination.
    if (role === Role.Mafia) {
      const allies = new Set(GameEngine.mafiaAllies(game, voterId));
      const town = living.filter((id) => !allies.has(id));
      const leader = this.tallyLeader(context?.tally, (id) =>
        town.includes(id),
      );
      return leader ?? this.pick(town);
    }

    // Town-aligned non-detective: follow a forming majority if aggressive,
    // otherwise sometimes abstain (hedging personalities).
    const leader = this.tallyLeader(context?.tally, (id) => living.includes(id));
    if (leader && Math.random() < persona.aggression) return leader;
    if (Math.random() < 0.2 * (1 - persona.aggression)) return null; // abstain
    return this.pick(living);
  }

  /**
   * Whether this AI should speak now, based on personality chattiness. Pure.
   */
  shouldSpeak(personalityId: string | undefined): boolean {
    return Math.random() < personalityById(personalityId).chattiness;
  }

  /**
   * Produce a short day-chat line. Bounded LLM call with an instant canned
   * fallback. The prompt contains ONLY public, role-safe context (never roles or
   * secret actions), so a compromised/odd model response cannot leak hidden
   * state — and we also never echo raw model text without validation.
   */
  async chatLine(args: {
    personalityId: string | undefined;
    selfName: string;
    livingNames: string[];
    themeBlurb: string;
    round: number;
  }): Promise<string> {
    const persona = personalityById(args.personalityId);
    const fallback =
      persona.fallbackLines[
        Math.floor(Math.random() * persona.fallbackLines.length)
      ];

    const prompt = [
      `You are ${args.selfName}, a player in a social deduction game.`,
      `Setting: ${args.themeBlurb}`,
      `Living players: ${args.livingNames.join(', ')}.`,
      `Your style: ${persona.stylePrompt}.`,
      'Say ONE short in-character line (max 20 words) to the group during the',
      'day discussion. Do NOT claim a secret role or reveal any hidden info.',
      'Respond ONLY as JSON: {"line": string}.',
    ].join('\n');

    const res = await this.ollama.generate(prompt, {
      timeoutMs: this.chatTimeoutMs,
      json: true,
      maxTokens: 60,
      temperature: 1.0,
      keepAlive: process.env.OLLAMA_KEEP_ALIVE ?? '30m',
      system:
        'You roleplay a single player in a mafia party game. Keep it short, ' +
        'natural, and broadly appropriate. Never reveal roles or hidden state.',
    });
    if (!res.ok) return fallback;
    const parsed = this.safeJson(res.text);
    const line = validateNarration(parsed);
    return line ?? fallback;
  }

  // --- helpers ---

  private pick<T>(arr: T[]): T | null {
    if (!arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  private tallyLeader(
    tally: Record<string, number> | undefined,
    eligible: (id: string) => boolean,
  ): string | null {
    if (!tally) return null;
    let best: string | null = null;
    let bestN = 0;
    for (const [id, n] of Object.entries(tally)) {
      if (id === 'ABSTAIN' || !eligible(id)) continue;
      if (n > bestN) {
        bestN = n;
        best = id;
      }
    }
    return best;
  }

  private safeJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      const s = text.indexOf('{');
      const e = text.lastIndexOf('}');
      if (s !== -1 && e > s) {
        try {
          return JSON.parse(text.slice(s, e + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}
