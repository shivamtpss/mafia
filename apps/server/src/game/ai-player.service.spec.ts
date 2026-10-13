import { AiPlayerService } from './ai-player.service';
import { GameEngine } from './game.engine';
import { GameState, emptyNight } from './game.state';
import { OllamaClient } from '../ai/ollama.client';
import { Role } from '@ai-mafia/shared';

/** Offline Ollama: chat always falls back to canned lines. */
function makeService(): AiPlayerService {
  const ollama = new OllamaClient();
  jest
    .spyOn(ollama, 'generate')
    .mockResolvedValue({ ok: false, text: '', error: 'offline (test)' });
  return new AiPlayerService(ollama);
}

function gameWithRoles(roleMap: Record<string, Role>): GameState {
  const ids = Object.keys(roleMap);
  return {
    roles: new Map(Object.entries(roleMap)),
    alive: new Set(ids),
    night: emptyNight(),
    votes: new Map(),
    round: 1,
    phaseTimer: null,
    resolving: false,
    timeline: [],
    winner: null,
    investigations: new Map(),
    aiTimers: new Set(),
  };
}

describe('AiPlayerService — night decisions (role-aware, always legal)', () => {
  const svc = makeService();

  it('mafia never targets self or a fellow mafia', () => {
    const game = gameWithRoles({
      m1: Role.Mafia,
      m2: Role.Mafia,
      t: Role.Townsperson,
      d: Role.Detective,
    });
    for (let i = 0; i < 50; i++) {
      const target = svc.decideNightTarget(game, 'm1');
      expect(target).not.toBe('m1');
      expect(target).not.toBe('m2');
      // Whatever it picks must be re-validated as legal by the engine.
      if (target) {
        const res = GameEngine.submitNightAction(game, 'm1', target);
        expect(res.ok).toBe(true);
        game.night = emptyNight(); // reset for next iteration
      }
    }
  });

  it('detective investigates a living player other than self', () => {
    const game = gameWithRoles({
      m: Role.Mafia,
      det: Role.Detective,
      doc: Role.Doctor,
      t: Role.Townsperson,
    });
    for (let i = 0; i < 25; i++) {
      const target = svc.decideNightTarget(game, 'det');
      expect(target).not.toBe('det');
      expect(target).not.toBeNull();
      const res = GameEngine.submitNightAction(game, 'det', target);
      expect(res.ok).toBe(true);
      game.night = emptyNight();
    }
  });

  it('doctor picks a living player (may self-protect)', () => {
    const game = gameWithRoles({
      m: Role.Mafia,
      det: Role.Detective,
      doc: Role.Doctor,
      t: Role.Townsperson,
    });
    for (let i = 0; i < 25; i++) {
      const target = svc.decideNightTarget(game, 'doc');
      expect(target).not.toBeNull();
      const res = GameEngine.submitNightAction(game, 'doc', target);
      expect(res.ok).toBe(true);
      game.night = emptyNight();
    }
  });

  it('townsperson has no night action', () => {
    const game = gameWithRoles({
      m: Role.Mafia,
      det: Role.Detective,
      doc: Role.Doctor,
      t: Role.Townsperson,
    });
    expect(svc.decideNightTarget(game, 't')).toBeNull();
  });
});

describe('AiPlayerService — vote decisions', () => {
  const svc = makeService();

  it('mafia never votes a fellow mafia', () => {
    const game = gameWithRoles({
      m1: Role.Mafia,
      m2: Role.Mafia,
      t1: Role.Townsperson,
      t2: Role.Townsperson,
      d: Role.Detective,
    });
    for (let i = 0; i < 50; i++) {
      const target = svc.decideVote(game, 'm1', { personalityId: 'strategist' });
      expect(target).not.toBe('m2');
      expect(target).not.toBe('m1');
    }
  });

  it('detective votes a personally-confirmed living mafioso', () => {
    const game = gameWithRoles({
      m: Role.Mafia,
      det: Role.Detective,
      t: Role.Townsperson,
      d2: Role.Doctor,
    });
    const memory = new Map<string, boolean>([['m', true]]);
    for (let i = 0; i < 20; i++) {
      const target = svc.decideVote(game, 'det', {
        knownMafiaResults: memory,
      });
      expect(target).toBe('m');
    }
  });

  it('votes are always for a living player or null (abstain)', () => {
    const game = gameWithRoles({
      m: Role.Mafia,
      det: Role.Detective,
      doc: Role.Doctor,
      t: Role.Townsperson,
    });
    for (let i = 0; i < 50; i++) {
      const target = svc.decideVote(game, 't', { personalityId: 'chaotic' });
      if (target !== null) {
        expect(game.alive.has(target)).toBe(true);
        expect(target).not.toBe('t');
      }
    }
  });
});

describe('AiPlayerService — chat fallback (bounded, safe)', () => {
  it('returns a non-empty canned line when the model is offline', async () => {
    const svc = makeService();
    const line = await svc.chatLine({
      personalityId: 'aggressive',
      selfName: 'Rook',
      livingNames: ['Rook', 'Vera', 'Dex'],
      themeBlurb: 'A fog-bound village.',
      round: 1,
    });
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
  });
});
