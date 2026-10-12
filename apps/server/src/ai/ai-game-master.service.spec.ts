import { AiGameMasterService } from './ai-game-master.service';
import { OllamaClient, OllamaResult } from './ollama.client';
import { DEFAULT_THEME_ID, getTheme } from '@ai-mafia/shared';

/** Build an AiGameMasterService over a stubbed OllamaClient. */
function makeService(
  generate: (prompt: string) => Promise<OllamaResult>,
): AiGameMasterService {
  const ollama = new OllamaClient();
  jest.spyOn(ollama, 'generate').mockImplementation((p) => generate(p));
  return new AiGameMasterService(ollama);
}

const okJson = (obj: unknown): Promise<OllamaResult> =>
  Promise.resolve({ ok: true, text: JSON.stringify(obj) });

describe('AiGameMasterService — scenario generation', () => {
  it('returns a validated scenario from well-formed JSON', async () => {
    const svc = makeService(() =>
      okJson({ title: 'Whispers in the Fog', intro: 'A cold night falls.' }),
    );
    const s = await svc.getScenario('haunted-village');
    expect(s.themeId).toBe('haunted-village');
    expect(s.title).toBe('Whispers in the Fog');
    expect(s.intro).toBe('A cold night falls.');
  });

  it('falls back to static theme flavor when the model is unavailable', async () => {
    const svc = makeService(() =>
      Promise.resolve({ ok: false, text: '', error: 'offline' }),
    );
    const theme = getTheme('cyberpunk-city');
    const s = await svc.getScenario('cyberpunk-city');
    expect(s.title).toBe(theme.name);
    expect(s.intro).toBe(theme.fallback.intro);
  });

  it('falls back when JSON is malformed', async () => {
    const svc = makeService(() =>
      Promise.resolve({ ok: true, text: 'not json at all' }),
    );
    const theme = getTheme('space-station');
    const s = await svc.getScenario('space-station');
    expect(s.intro).toBe(theme.fallback.intro);
  });

  it('extracts JSON embedded in surrounding prose', async () => {
    const svc = makeService(() =>
      Promise.resolve({
        ok: true,
        text: 'Sure! {"title":"The Vent","intro":"Air hisses in the dark."} hope that helps',
      }),
    );
    const s = await svc.getScenario('space-station');
    expect(s.title).toBe('The Vent');
  });

  it('falls back when required fields are missing (schema invalid)', async () => {
    const svc = makeService(() => okJson({ title: 'No intro here' }));
    const theme = getTheme('medieval-kingdom');
    const s = await svc.getScenario('medieval-kingdom');
    expect(s.intro).toBe(theme.fallback.intro);
  });

  it('caches the scenario so the model is only called once per theme', async () => {
    const generate = jest.fn(() =>
      okJson({ title: 'Cached Tale', intro: 'Once only.' }),
    );
    const svc = makeService(generate);
    await svc.getScenario('haunted-village');
    await svc.getScenario('haunted-village');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('truncates overly long generated text to the schema limits', async () => {
    const longIntro = 'x'.repeat(5000);
    const svc = makeService(() => okJson({ title: 'T', intro: longIntro }));
    const s = await svc.getScenario('haunted-village');
    expect(s.intro.length).toBeLessThanOrEqual(600);
  });
});

describe('AiGameMasterService — narration', () => {
  it('returns a validated narration line from JSON', async () => {
    const svc = makeService(() => okJson({ line: 'The shadows lengthen.' }));
    const line = await svc.narrate('haunted-village', 'night', { seed: 1 });
    expect(line).toBe('The shadows lengthen.');
  });

  it('falls back to the static theme line when unavailable', async () => {
    const svc = makeService(() =>
      Promise.resolve({ ok: false, text: '', error: 'timeout' }),
    );
    const theme = getTheme('haunted-village');
    const line = await svc.narrate('haunted-village', 'night', { seed: 1 });
    expect(line).toBe(theme.fallback.night);
  });

  it('falls back when the line is empty/invalid', async () => {
    const svc = makeService(() => okJson({ line: '   ' }));
    const theme = getTheme('cyberpunk-city');
    const line = await svc.narrate('cyberpunk-city', 'day', { seed: 2 });
    expect(line).toBe(theme.fallback.day);
  });

  it('caches narration by theme/beat/bucket', async () => {
    const generate = jest.fn(() => okJson({ line: 'Once.' }));
    const svc = makeService(generate);
    await svc.narrate('haunted-village', 'voting', { seed: 3 });
    await svc.narrate('haunted-village', 'voting', { seed: 3 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('maps phases to beats correctly', () => {
    // GamePhase values are imported indirectly via shared; use string checks.
    const { GamePhase } = require('@ai-mafia/shared');
    expect(AiGameMasterService.beatForPhase(GamePhase.Night)).toBe('night');
    expect(AiGameMasterService.beatForPhase(GamePhase.Day)).toBe('day');
    expect(AiGameMasterService.beatForPhase(GamePhase.Voting)).toBe('voting');
    expect(AiGameMasterService.beatForPhase(GamePhase.Lobby)).toBeNull();
    expect(AiGameMasterService.beatForPhase(GamePhase.RoleReveal)).toBeNull();
  });

  it('uses the default theme for an unknown theme id', async () => {
    const svc = makeService(() =>
      Promise.resolve({ ok: false, text: '', error: 'offline' }),
    );
    const def = getTheme(DEFAULT_THEME_ID);
    const line = await svc.narrate('does-not-exist', 'night', { seed: 0 });
    expect(line).toBe(def.fallback.night);
  });
});
