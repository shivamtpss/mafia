import { Role, Team, ROLE_TEAM } from './types';

/**
 * Pure, deterministic game-rule helpers shared by the server engine and tests.
 * No randomness or I/O here beyond an injectable RNG, so outcomes are fully
 * reproducible and unit-testable.
 */

/** The night actions a role may submit. */
export const ROLE_NIGHT_ACTION: Record<Role, 'KILL' | 'INVESTIGATE' | 'PROTECT' | null> = {
  [Role.Mafia]: 'KILL',
  [Role.Detective]: 'INVESTIGATE',
  [Role.Doctor]: 'PROTECT',
  [Role.Townsperson]: null,
};

/** Whether a role acts at night at all. */
export function roleActsAtNight(role: Role): boolean {
  return ROLE_NIGHT_ACTION[role] !== null;
}

export interface AlivePlayer {
  id: string;
  role: Role;
  alive: boolean;
}

/**
 * Determine the winning team given the current set of players, or null if the
 * game continues.
 *
 * Rules:
 *  - Town wins when no Mafia remain alive.
 *  - Mafia wins when living Mafia >= living Town (they can no longer be
 *    out-voted).
 */
export function checkWinner(
  players: Array<{ role: Role; alive: boolean }>,
): Team | null {
  const alive = players.filter((p) => p.alive);
  const mafia = alive.filter((p) => ROLE_TEAM[p.role] === Team.Mafia).length;
  const town = alive.length - mafia;

  if (mafia === 0) return Team.Town;
  if (mafia >= town) return Team.Mafia;
  return null;
}

export interface NightSubmission {
  mafiaTargetId?: string | null;
  doctorTargetId?: string | null;
  detectiveTargetId?: string | null;
}

export interface NightResolution {
  /** Player killed this night, or null if nobody died (saved / no target). */
  killedId: string | null;
  /** Whether the doctor's save prevented a kill. */
  savedByDoctor: boolean;
  /** Detective's investigation result, if they investigated. */
  investigation: { targetId: string; isMafia: boolean } | null;
}

/**
 * Resolve the night phase deterministically from submitted actions.
 * Protection cancels the mafia kill when the doctor protected the same target.
 */
export function resolveNight(
  submission: NightSubmission,
  roleOf: (playerId: string) => Role | undefined,
): NightResolution {
  const { mafiaTargetId, doctorTargetId, detectiveTargetId } = submission;

  let killedId: string | null = null;
  let savedByDoctor = false;

  if (mafiaTargetId) {
    if (doctorTargetId && doctorTargetId === mafiaTargetId) {
      savedByDoctor = true;
      killedId = null;
    } else {
      killedId = mafiaTargetId;
    }
  }

  let investigation: NightResolution['investigation'] = null;
  if (detectiveTargetId) {
    const role = roleOf(detectiveTargetId);
    investigation = {
      targetId: detectiveTargetId,
      isMafia: role !== undefined && ROLE_TEAM[role] === Team.Mafia,
    };
  }

  return { killedId, savedByDoctor, investigation };
}

export interface VoteResolution {
  /** Player eliminated by the vote, or null on a tie / all-abstain. */
  eliminatedId: string | null;
  tie: boolean;
  /** Final tally: targetId -> count (abstentions excluded). */
  counts: Record<string, number>;
}

/**
 * Resolve day voting. A plurality wins; ties result in no elimination.
 * `votes` maps voterId -> targetId (or null/ABSTAIN to abstain).
 */
export function resolveVotes(
  votes: Record<string, string | null>,
): VoteResolution {
  const counts: Record<string, number> = {};
  for (const target of Object.values(votes)) {
    if (!target) continue; // abstain
    counts[target] = (counts[target] ?? 0) + 1;
  }

  let max = 0;
  let leaders: string[] = [];
  for (const [targetId, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      leaders = [targetId];
    } else if (count === max) {
      leaders.push(targetId);
    }
  }

  if (max === 0 || leaders.length !== 1) {
    return { eliminatedId: null, tie: leaders.length > 1, counts };
  }
  return { eliminatedId: leaders[0], tie: false, counts };
}

/**
 * Fisher-Yates shuffle using an injectable RNG (default Math.random) so tests
 * can supply a deterministic sequence.
 */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
