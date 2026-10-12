import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  GamePhase,
  Scenario,
  ThemeDef,
  getTheme,
  validateNarration,
  validateScenario,
} from '@ai-mafia/shared';
import { OllamaClient } from './ollama.client';

/** Narration "beats" the game master can produce for a phase/event. */
export type NarrationBeat =
  | 'night'
  | 'day'
  | 'voting'
  | 'townWin'
  | 'mafiaWin';

/**
 * AiGameMasterService: themed scenario generation + dynamic narration via the
 * local Ollama model. Every method is bounded and falls back to deterministic,
 * theme-appropriate static text, so narration never blocks or crashes the
 * authoritative game loop. Generated text is validated against a strict schema
 * and is kept entirely separate from trusted game commands.
 */
@Injectable()
export class AiGameMasterService implements OnModuleInit {
  private readonly logger = new Logger(AiGameMasterService.name);
  private readonly scenarioTimeoutMs: number;
  private readonly narrationTimeoutMs: number;
  /** keep_alive value sent to Ollama to keep the model resident. */
  private readonly keepAlive: string;
  /** Whether to pre-warm the model on startup (default on). */
  private readonly warmOnBoot: boolean;

  /** Cache of scenarios keyed by themeId to avoid regenerating constantly. */
  private readonly scenarioCache = new Map<string, Scenario>();
  /** Cache of narration lines keyed by `${themeId}:${beat}:${bucket}`. */
  private readonly narrationCache = new Map<string, string>();

  constructor(private readonly ollama: OllamaClient) {
    const base = Number(process.env.AI_INFERENCE_TIMEOUT_MS ?? 8000);
    this.narrationTimeoutMs = Number.isFinite(base) ? base : 8000;
    // Scenario generation gets a little more headroom (cold model load).
    this.scenarioTimeoutMs = this.narrationTimeoutMs * 2;
    this.keepAlive = process.env.OLLAMA_KEEP_ALIVE ?? '30m';
    this.warmOnBoot =
      (process.env.AI_WARM_ON_BOOT ?? 'true').toLowerCase() !== 'false';
  }

  /**
   * On startup, pre-warm the model (non-blocking) so the first real game does
   * not pay the cold-load penalty. Failures are ignored; fallbacks cover them.
   */
  onModuleInit(): void {
    this.logger.log(
      `AI config: narrationTimeout=${this.narrationTimeoutMs}ms ` +
        `scenarioTimeout=${this.scenarioTimeoutMs}ms ` +
        `keepAlive=${this.keepAlive} warmOnBoot=${this.warmOnBoot}`,
    );
    if (!this.warmOnBoot) return;
    void this.ollama.warm(this.keepAlive).catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Scenario generation
  // -------------------------------------------------------------------------

  /**
   * Generate (or reuse a cached) scenario for a theme. Always returns a usable
   * Scenario, falling back to static theme flavor on any failure.
   */
  async getScenario(themeId: string | undefined): Promise<Scenario> {
    const theme = getTheme(themeId);
    const cached = this.scenarioCache.get(theme.id);
    if (cached) return cached;

    const scenario = await this.generateScenario(theme);
    this.scenarioCache.set(theme.id, scenario);
    return scenario;
  }

  /** Pre-warm a theme's scenario (fire-and-forget from the lobby). */
  prewarm(themeId: string | undefined): void {
    const theme = getTheme(themeId);
    if (this.scenarioCache.has(theme.id)) return;
    void this.getScenario(theme.id);
  }

  private async generateScenario(theme: ThemeDef): Promise<Scenario> {
    const fallback: Scenario = {
      themeId: theme.id,
      title: theme.name,
      intro: theme.fallback.intro,
    };

    const prompt = this.scenarioPrompt(theme);
    const res = await this.ollama.generate(prompt, {
      timeoutMs: this.scenarioTimeoutMs,
      json: true,
      maxTokens: 400,
      temperature: 0.9,
      keepAlive: this.keepAlive,
      system:
        'You are a game master writing short, atmospheric, PG-13 flavor text ' +
        'for a social deduction game. Respond ONLY with JSON. Never include ' +
        'game rules, player instructions, or hidden information.',
    });
    if (!res.ok) {
      this.logger.debug(`Scenario fell back (${res.error}) for ${theme.id}`);
      return fallback;
    }
    const parsed = this.safeJson(res.text);
    const scenario = validateScenario(parsed, theme.id);
    if (!scenario) {
      this.logger.debug(`Scenario schema invalid for ${theme.id}, using fallback`);
      return fallback;
    }
    return scenario;
  }

  private scenarioPrompt(theme: ThemeDef): string {
    return [
      `Theme: ${theme.name}. Premise: ${theme.blurb}`,
      `The hidden villains are called "${theme.villainName}"; the innocents are "${theme.townName}".`,
      'Write a JSON object with exactly these keys:',
      '{"title": string (<= 8 words), "intro": string (2-3 sentences, atmospheric)}',
      'Do not mention game mechanics, roles, or voting. Keep it broadly appropriate.',
    ].join('\n');
  }

  // -------------------------------------------------------------------------
  // Phase narration
  // -------------------------------------------------------------------------

  /**
   * Produce a narration line for a phase/event. Bounded; always returns text,
   * falling back to the theme's static line. `seed` lets callers vary lines
   * (e.g. round number) while keeping caching effective.
   */
  async narrate(
    themeId: string | undefined,
    beat: NarrationBeat,
    context?: { seed?: number; victimName?: string | null },
  ): Promise<string> {
    const theme = getTheme(themeId);
    const fallbackLine = this.fallbackFor(theme, beat);

    // Cache per theme+beat+small-bucket so we are not calling the model every
    // single phase; narration is flavor, not state.
    const bucket = (context?.seed ?? 0) % 3;
    const key = `${theme.id}:${beat}:${bucket}`;
    const cachedLine = this.narrationCache.get(key);
    if (cachedLine) return cachedLine;

    const prompt = this.narrationPrompt(theme, beat, context);
    const res = await this.ollama.generate(prompt, {
      timeoutMs: this.narrationTimeoutMs,
      json: true,
      maxTokens: 120,
      temperature: 0.9,
      keepAlive: this.keepAlive,
      system:
        'You narrate a social deduction game in a given theme. Respond ONLY ' +
        'with JSON like {"line": string}. One or two vivid sentences. Never ' +
        'reveal roles or secret actions. Keep it broadly appropriate (PG-13).',
    });
    if (!res.ok) return fallbackLine;

    const parsed = this.safeJson(res.text);
    const line = validateNarration(parsed);
    if (!line) return fallbackLine;

    this.narrationCache.set(key, line);
    return line;
  }

  private narrationPrompt(
    theme: ThemeDef,
    beat: NarrationBeat,
    context?: { seed?: number; victimName?: string | null },
  ): string {
    const beatText: Record<NarrationBeat, string> = {
      night: `Night falls. The ${theme.villainName} move in secret.`,
      day: context?.victimName
        ? `Dawn breaks. ${context.victimName} did not survive the night.`
        : 'Dawn breaks after a quiet night; no one died.',
      voting: 'The group must now accuse and vote.',
      townWin: `The ${theme.townName} have won.`,
      mafiaWin: `The ${theme.villainName} have won.`,
    };
    return [
      `Theme: ${theme.name}. ${theme.blurb}`,
      `Moment: ${beatText[beat]}`,
      'Write JSON {"line": string} with one or two atmospheric sentences for this moment.',
      'Do not mention roles, mechanics, or who is secretly the villain.',
    ].join('\n');
  }

  private fallbackFor(theme: ThemeDef, beat: NarrationBeat): string {
    switch (beat) {
      case 'night':
        return theme.fallback.night;
      case 'day':
        return theme.fallback.day;
      case 'voting':
        return theme.fallback.voting;
      case 'townWin':
        return theme.fallback.townWin;
      case 'mafiaWin':
        return theme.fallback.mafiaWin;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Parse JSON defensively; some models wrap output in prose or code fences. */
  private safeJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      // Attempt to extract the first {...} block.
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /** Map a GamePhase to a narration beat, or null if the phase has no narration. */
  static beatForPhase(phase: GamePhase): NarrationBeat | null {
    switch (phase) {
      case GamePhase.Night:
        return 'night';
      case GamePhase.Day:
        return 'day';
      case GamePhase.Voting:
        return 'voting';
      default:
        return null;
    }
  }

  /** Clear caches (e.g. for tests or admin refresh). */
  clearCache(): void {
    this.scenarioCache.clear();
    this.narrationCache.clear();
  }
}
