import { MAX_PLAYERS, MIN_PLAYERS, Role, Team, ROLE_TEAM, roleBag, roleDistribution } from '@ai-mafia/shared';

describe('role distribution', () => {
  it('always sums to the player count across the supported range', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const dist = roleDistribution(n);
      const total =
        dist[Role.Mafia] +
        dist[Role.Detective] +
        dist[Role.Doctor] +
        dist[Role.Townsperson];
      expect(total).toBe(n);
      expect(roleBag(n)).toHaveLength(n);
    }
  });

  it('always includes at least one mafia and one detective', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const dist = roleDistribution(n);
      expect(dist[Role.Mafia]).toBeGreaterThanOrEqual(1);
      expect(dist[Role.Detective]).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps town outnumbering mafia at game start', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const dist = roleDistribution(n);
      const town = n - dist[Role.Mafia];
      expect(town).toBeGreaterThan(dist[Role.Mafia]);
    }
  });

  it('throws for out-of-range counts', () => {
    expect(() => roleDistribution(MIN_PLAYERS - 1)).toThrow();
    expect(() => roleDistribution(MAX_PLAYERS + 1)).toThrow();
  });

  it('maps every role to a team', () => {
    expect(ROLE_TEAM[Role.Mafia]).toBe(Team.Mafia);
    expect(ROLE_TEAM[Role.Detective]).toBe(Team.Town);
    expect(ROLE_TEAM[Role.Doctor]).toBe(Team.Town);
    expect(ROLE_TEAM[Role.Townsperson]).toBe(Team.Town);
  });
});
