import { GamePhase, Role, Team } from '@ai-mafia/shared';

/**
 * Server-only authoritative game state. This is attached to a room while a game
 * is in progress and is NEVER serialized into the public room projection. Secret
 * fields (roles, night actions, votes) live here and are only revealed to the
 * players entitled to see them, via targeted socket emits.
 */
export interface GameState {
  /** playerId -> secret role. */
  roles: Map<string, Role>;
  /** Ids of players currently alive (subset of room players). */
  alive: Set<string>;
  /** Current night's submitted actions, cleared each night. */
  night: NightActions;
  /** Current day's votes: voterId -> targetId|null (abstain). */
  votes: Map<string, string | null>;
  /** Monotonic night/day round number. */
  round: number;
  /** Timeout handle for the active phase (server scheduler). */
  phaseTimer: NodeJS.Timeout | null;
  /** Guards against double-resolving a phase (timer + all-submitted race). */
  resolving: boolean;
  /** Public timeline of events for the results screen / replay. */
  timeline: TimelineEntry[];
  /** Set once the game is decided. */
  winner: Team | null;
  /**
   * Per-detective investigation memory: detectiveId -> (targetId -> isMafia).
   * Used by AI detectives to act/vote on what THEY personally learned. Humans
   * get their results via private emit; this is the server-side record.
   */
  investigations: Map<string, Map<string, boolean>>;
  /** Pending AI action timers (night/vote/chat) so we can cancel on teardown. */
  aiTimers: Set<NodeJS.Timeout>;
}

export interface NightActions {
  /** Mafia kill target (shared among mafia; last write wins, logged). */
  mafiaTargetId: string | null;
  doctorTargetId: string | null;
  detectiveTargetId: string | null;
  /** Which living actors have submitted this night (by playerId). */
  submitted: Set<string>;
}

export interface TimelineEntry {
  round: number;
  phase: GamePhase;
  at: number;
  text: string;
}

export function emptyNight(): NightActions {
  return {
    mafiaTargetId: null,
    doctorTargetId: null,
    detectiveTargetId: null,
    submitted: new Set(),
  };
}
