import { GameEngine } from './game.engine';
import { Role, Team } from '@ai-mafia/shared';
import { GameState, emptyNight } from './game.state';

/** Deterministic RNG that always returns 0 (shuffle becomes identity-ish). */
const zeroRng = () => 0;

/**
 * Build a GameState with an explicit role map, bypassing the player-count
 * constraint in create() so we can test small win-condition scenarios.
 */
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
  };
}

describe('GameEngine — role assignment', () => {
  it('assigns exactly one role per player from the role bag', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const game = GameEngine.create(ids, zeroRng);
    expect(game.roles.size).toBe(6);
    for (const id of ids) expect(game.roles.has(id)).toBe(true);
    // All players start alive.
    expect(game.alive.size).toBe(6);
  });

  it('produces a valid distribution (>=1 mafia, >=1 detective)', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const game = GameEngine.create(ids);
    const roles = [...game.roles.values()];
    expect(roles.filter((r) => r === Role.Mafia).length).toBeGreaterThanOrEqual(1);
    expect(roles.filter((r) => r === Role.Detective).length).toBe(1);
  });

  it('reveals mafia allies only to mafia members', () => {
    const game = gameWithRoles({
      a: Role.Mafia,
      b: Role.Mafia,
      c: Role.Detective,
      d: Role.Townsperson,
    });
    expect(GameEngine.mafiaAllies(game, 'a').sort()).toEqual(['b']);
    expect(GameEngine.mafiaAllies(game, 'b').sort()).toEqual(['a']);
    // A town player, if asked, would see all mafia — but the service only calls
    // this for mafia. Verify the helper itself lists mafia excluding self.
    expect(GameEngine.mafiaAllies(game, 'c').sort()).toEqual(['a', 'b']);
  });
});

describe('GameEngine — night actions', () => {
  it('mafia kill with no doctor save kills the target', () => {
    const game = gameWithRoles({
      m: Role.Mafia,
      det: Role.Detective,
      doc: Role.Doctor,
      t: Role.Townsperson,
    });
    GameEngine.submitNightAction(game, 'm', 't');
    const res = GameEngine.resolveNight(game);
    expect(res.killedId).toBe('t');
    expect(res.savedByDoctor).toBe(false);
    expect(game.alive.has('t')).toBe(false);
  });

  it('doctor save on the mafia target prevents the kill', () => {
    const game = gameWithRoles({
      m: Role.Mafia,
      det: Role.Detective,
      doc: Role.Doctor,
      t: Role.Townsperson,
    });
    GameEngine.submitNightAction(game, 'm', 't');
    GameEngine.submitNightAction(game, 'doc', 't');
    const res = GameEngine.resolveNight(game);
    expect(res.killedId).toBeNull();
    expect(res.savedByDoctor).toBe(true);
    expect(game.alive.has('t')).toBe(true);
  });

  it('detective investigation reports mafia correctly', () => {
    const game = gameWithRoles({
      m: Role.Mafia,
      det: Role.Detective,
      doc: Role.Doctor,
      t: Role.Townsperson,
    });
    GameEngine.submitNightAction(game, 'det', 'm');
    const res = GameEngine.resolveNight(game);
    expect(res.investigation).toEqual({ targetId: 'm', isMafia: true });
  });

  it('detective investigation reports town correctly', () => {
    const game = gameWithRoles({
      m: Role.Mafia,
      det: Role.Detective,
      doc: Role.Doctor,
      t: Role.Townsperson,
    });
    GameEngine.submitNightAction(game, 'det', 't');
    const res = GameEngine.resolveNight(game);
    expect(res.investigation).toEqual({ targetId: 't', isMafia: false });
  });

  it('rejects night actions from a role with no night power', () => {
    const game = gameWithRoles({ m: Role.Mafia, t: Role.Townsperson, t2: Role.Townsperson, det: Role.Detective });
    const res = GameEngine.submitNightAction(game, 't', 'm');
    expect(res.ok).toBe(false);
  });

  it('rejects mafia targeting a fellow mafia', () => {
    const game = gameWithRoles({ m1: Role.Mafia, m2: Role.Mafia, t: Role.Townsperson, det: Role.Detective });
    const res = GameEngine.submitNightAction(game, 'm1', 'm2');
    expect(res.ok).toBe(false);
  });

  it('rejects actions against a dead target', () => {
    const game = gameWithRoles({ m: Role.Mafia, det: Role.Detective, doc: Role.Doctor, t: Role.Townsperson });
    game.alive.delete('t');
    const res = GameEngine.submitNightAction(game, 'm', 't');
    expect(res.ok).toBe(false);
  });

  it('rejects a dead actor acting', () => {
    const game = gameWithRoles({ m: Role.Mafia, det: Role.Detective, doc: Role.Doctor, t: Role.Townsperson });
    game.alive.delete('m');
    const res = GameEngine.submitNightAction(game, 'm', 't');
    expect(res.ok).toBe(false);
  });

  it('tracks pending night actors and early-resolution readiness', () => {
    const game = gameWithRoles({ m: Role.Mafia, det: Role.Detective, doc: Role.Doctor, t: Role.Townsperson });
    expect(GameEngine.allNightActionsIn(game)).toBe(false);
    GameEngine.submitNightAction(game, 'm', 't');
    GameEngine.submitNightAction(game, 'det', 't');
    GameEngine.submitNightAction(game, 'doc', 't');
    expect(GameEngine.allNightActionsIn(game)).toBe(true);
  });
});

describe('GameEngine — voting', () => {
  function votingGame(): GameState {
    return gameWithRoles({
      a: Role.Mafia,
      b: Role.Detective,
      c: Role.Doctor,
      d: Role.Townsperson,
    });
  }

  it('eliminates the plurality target', () => {
    const game = votingGame();
    GameEngine.submitVote(game, 'a', 'd', true);
    GameEngine.submitVote(game, 'b', 'd', true);
    GameEngine.submitVote(game, 'c', 'a', true);
    const res = GameEngine.resolveVotes(game);
    expect(res.eliminatedId).toBe('d');
    expect(game.alive.has('d')).toBe(false);
  });

  it('results in no elimination on a tie', () => {
    const game = votingGame();
    GameEngine.submitVote(game, 'a', 'd', true);
    GameEngine.submitVote(game, 'b', 'd', true);
    GameEngine.submitVote(game, 'c', 'a', true);
    GameEngine.submitVote(game, 'd', 'a', true);
    const res = GameEngine.resolveVotes(game);
    expect(res.tie).toBe(true);
    expect(res.eliminatedId).toBeNull();
  });

  it('abstentions are not counted and can yield no elimination', () => {
    const game = votingGame();
    GameEngine.submitVote(game, 'a', null, true);
    GameEngine.submitVote(game, 'b', null, true);
    const res = GameEngine.resolveVotes(game);
    expect(res.eliminatedId).toBeNull();
  });

  it('rejects a dead player voting', () => {
    const game = votingGame();
    game.alive.delete('d');
    const res = GameEngine.submitVote(game, 'd', 'a', true);
    expect(res.ok).toBe(false);
  });

  it('rejects a second vote when vote-change is disallowed', () => {
    const game = votingGame();
    expect(GameEngine.submitVote(game, 'a', 'd', false).ok).toBe(true);
    expect(GameEngine.submitVote(game, 'a', 'b', false).ok).toBe(false);
  });

  it('allows changing a vote when permitted', () => {
    const game = votingGame();
    GameEngine.submitVote(game, 'a', 'd', true);
    GameEngine.submitVote(game, 'a', 'b', true);
    expect(game.votes.get('a')).toBe('b');
  });
});

describe('GameEngine — win conditions', () => {
  it('town wins when no mafia remain', () => {
    const game = gameWithRoles({ a: Role.Mafia, b: Role.Detective, c: Role.Townsperson });
    game.alive.delete('a');
    expect(GameEngine.winner(game)).toBe(Team.Town);
  });

  it('mafia wins at parity with town', () => {
    const game = gameWithRoles({ a: Role.Mafia, b: Role.Detective, c: Role.Townsperson });
    // Kill the townsperson -> 1 mafia vs 1 detective (town) => parity => mafia win.
    game.alive.delete('c');
    expect(GameEngine.winner(game)).toBe(Team.Mafia);
  });

  it('game continues while town outnumbers mafia', () => {
    const game = gameWithRoles({ a: Role.Mafia, b: Role.Detective, c: Role.Doctor, d: Role.Townsperson });
    expect(GameEngine.winner(game)).toBeNull();
  });
});
