import {
  Role,
  Team,
  ROLE_TEAM,
  GamePhase,
  roleBag,
  shuffle,
  resolveNight,
  resolveVotes,
  checkWinner,
  roleActsAtNight,
  NightResolution,
  VoteResolution,
} from '@ai-mafia/shared';
import { GameState, emptyNight } from './game.state';

/**
 * Pure, deterministic game engine. It owns transitions on {@link GameState} but
 * performs no I/O, no timers, and no socket work. The GameService drives it and
 * handles scheduling + emits. An injectable RNG keeps role assignment testable.
 */
export class GameEngine {
  /**
   * Create a fresh GameState for the given player ids. Roles are drawn from the
   * deterministic role bag for the player count and shuffled across seats.
   */
  static create(playerIds: string[], rng: () => number = Math.random): GameState {
    const bag = shuffle(roleBag(playerIds.length), rng);
    const roles = new Map<string, Role>();
    playerIds.forEach((id, i) => roles.set(id, bag[i]));

    return {
      roles,
      alive: new Set(playerIds),
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

  static roleOf(game: GameState, playerId: string): Role | undefined {
    return game.roles.get(playerId);
  }

  static teamOf(game: GameState, playerId: string): Team | undefined {
    const role = game.roles.get(playerId);
    return role ? ROLE_TEAM[role] : undefined;
  }

  static isAlive(game: GameState, playerId: string): boolean {
    return game.alive.has(playerId);
  }

  static livingPlayers(game: GameState): string[] {
    return [...game.alive];
  }

  static livingMafia(game: GameState): string[] {
    return [...game.alive].filter(
      (id) => ROLE_TEAM[game.roles.get(id)!] === Team.Mafia,
    );
  }

  /** Allies a mafia member is allowed to know about (other living+dead mafia). */
  static mafiaAllies(game: GameState, playerId: string): string[] {
    return [...game.roles.entries()]
      .filter(([id, role]) => id !== playerId && ROLE_TEAM[role] === Team.Mafia)
      .map(([id]) => id);
  }

  /**
   * Which living players still need to act this night (mafia/detective/doctor
   * that have not yet submitted). Used to decide if the night can resolve early.
   */
  static pendingNightActors(game: GameState): string[] {
    return [...game.alive].filter(
      (id) =>
        roleActsAtNight(game.roles.get(id)!) && !game.night.submitted.has(id),
    );
  }

  static allNightActionsIn(game: GameState): boolean {
    return this.pendingNightActors(game).length === 0;
  }

  /**
   * Record a night action from a player. Validates role/alive/target and
   * returns an error string on rejection (caller maps to an ack error).
   */
  static submitNightAction(
    game: GameState,
    actorId: string,
    targetId: string | null,
  ): { ok: true } | { ok: false; reason: string } {
    if (!game.alive.has(actorId)) return { ok: false, reason: 'You are not alive' };
    const role = game.roles.get(actorId);
    if (!role || !roleActsAtNight(role))
      return { ok: false, reason: 'Your role has no night action' };

    // Target validation (null = skip, allowed for all actors).
    if (targetId !== null) {
      if (!game.alive.has(targetId))
        return { ok: false, reason: 'Target is not alive' };
      // Mafia may not target fellow mafia.
      if (role === Role.Mafia && ROLE_TEAM[game.roles.get(targetId)!] === Team.Mafia)
        return { ok: false, reason: 'Cannot target a fellow mafia' };
      // Detective/doctor may not target themselves for investigate; doctor may
      // self-protect (common rule). We allow doctor self-save, forbid detective
      // self-investigate (pointless) and mafia self-target.
      if (role === Role.Detective && targetId === actorId)
        return { ok: false, reason: 'Cannot investigate yourself' };
      if (role === Role.Mafia && targetId === actorId)
        return { ok: false, reason: 'Cannot target yourself' };
    }

    switch (role) {
      case Role.Mafia:
        game.night.mafiaTargetId = targetId;
        break;
      case Role.Doctor:
        game.night.doctorTargetId = targetId;
        break;
      case Role.Detective:
        game.night.detectiveTargetId = targetId;
        break;
      default:
        return { ok: false, reason: 'Your role has no night action' };
    }
    game.night.submitted.add(actorId);
    return { ok: true };
  }

  /** Resolve the current night and apply the kill. Does not clear night state. */
  static resolveNight(game: GameState): NightResolution {
    const resolution = resolveNight(
      {
        mafiaTargetId: game.night.mafiaTargetId,
        doctorTargetId: game.night.doctorTargetId,
        detectiveTargetId: game.night.detectiveTargetId,
      },
      (id) => game.roles.get(id),
    );
    if (resolution.killedId) {
      game.alive.delete(resolution.killedId);
    }
    return resolution;
  }

  static beginNight(game: GameState): void {
    game.night = emptyNight();
  }

  // --- Voting ---

  static livingVoters(game: GameState): string[] {
    return [...game.alive];
  }

  static submitVote(
    game: GameState,
    voterId: string,
    targetId: string | null,
    allowChange: boolean,
  ): { ok: true } | { ok: false; reason: string } {
    if (!game.alive.has(voterId))
      return { ok: false, reason: 'Dead players cannot vote' };
    if (!allowChange && game.votes.has(voterId))
      return { ok: false, reason: 'You have already voted' };
    if (targetId !== null && !game.alive.has(targetId))
      return { ok: false, reason: 'Target is not alive' };
    game.votes.set(voterId, targetId);
    return { ok: true };
  }

  static allVotesIn(game: GameState): boolean {
    return game.votes.size >= game.alive.size;
  }

  static resolveVotes(game: GameState): VoteResolution {
    const votes: Record<string, string | null> = {};
    for (const [voter, target] of game.votes.entries()) votes[voter] = target;
    const resolution = resolveVotes(votes);
    if (resolution.eliminatedId) {
      game.alive.delete(resolution.eliminatedId);
    }
    return resolution;
  }

  static beginVoting(game: GameState): void {
    game.votes = new Map();
  }

  /** Check for a winner from the current alive set. */
  static winner(game: GameState): Team | null {
    const players = [...game.roles.entries()].map(([id, role]) => ({
      role,
      alive: game.alive.has(id),
    }));
    return checkWinner(players);
  }

  static addTimeline(
    game: GameState,
    phase: GamePhase,
    text: string,
  ): void {
    game.timeline.push({ round: game.round, phase, at: Date.now(), text });
  }
}
