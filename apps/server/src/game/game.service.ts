import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  GamePhase,
  PlayerKind,
  PlayerStatus,
  ROLE_TEAM,
  Role,
  Team,
  getTheme,
} from '@ai-mafia/shared';
import { RoomEntity, toPublicRoomState } from '../rooms/room.entity';
import { RoomStore } from '../rooms/room.store';
import { RoomError } from '../rooms/room.error';
import { GameEngine } from './game.engine';
import { GameEmitter } from './game.emitter';
import { GameState } from './game.state';
import { generateMessageId } from '../common/ids';
import { AiGameMasterService } from '../ai/ai-game-master.service';
import { AiPlayerService } from './ai-player.service';

/**
 * Orchestrates a live match: phase scheduling with server timers, action intake,
 * deterministic resolution via {@link GameEngine}, private/secret emits, and win
 * detection. All decisions are authoritative here; the gateway only forwards
 * validated requests and implements the {@link GameEmitter} transport.
 */
@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);
  private emitter!: GameEmitter;

  constructor(
    private readonly store: RoomStore,
    private readonly ai: AiGameMasterService,
    private readonly aiPlayer: AiPlayerService,
  ) {}

  /** Wire the transport. Called once by the gateway after construction. */
  registerEmitter(emitter: GameEmitter): void {
    this.emitter = emitter;
  }

  // -------------------------------------------------------------------------
  // Game lifecycle
  // -------------------------------------------------------------------------

  /**
   * Begin a match in a lobby room. Assigns roles, sends each player their
   * private role, and schedules the first phase (role reveal -> night).
   * `rng` is injectable for tests.
   */
  startGame(room: RoomEntity, rng: () => number = Math.random): void {
    const playerIds = [...room.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.id);

    const game = GameEngine.create(playerIds, rng);
    room.game = game;
    room.phase = GamePhase.RoleReveal;
    room.round = 1;
    room.updatedAt = Date.now();

    // Send each player their private role (and mafia their allies).
    for (const player of room.players.values()) {
      const role = game.roles.get(player.id)!;
      const team = ROLE_TEAM[role];
      const allies =
        role === Role.Mafia ? GameEngine.mafiaAllies(game, player.id) : undefined;
      this.emitter.roleAssigned(player.id, {
        playerId: player.id,
        role,
        team,
        allies,
      });
    }

    GameEngine.addTimeline(game, GamePhase.RoleReveal, 'Roles have been assigned.');
    this.broadcast(room);
    this.enterPhase(room, GamePhase.RoleReveal);

    // Non-blocking: fetch (or reuse) a themed scenario and post its intro as a
    // narrator line. If Ollama is slow/unavailable this still resolves to static
    // theme flavor; it never blocks the authoritative loop above.
    void this.ai
      .getScenario(room.settings.themeId)
      .then((scenario) => {
        const current = this.store.get(room.code);
        if (!current || current.game !== game) return; // game ended/reset
        this.systemLine(room, `${scenario.title} — ${scenario.intro}`);
      })
      .catch(() => undefined);
  }

  /**
   * Restart a finished game back into the lobby so players can rematch. Clears
   * all secret state and resets readiness.
   */
  rematch(room: RoomEntity): void {
    this.clearTimer(room);
    room.game = undefined;
    room.phase = GamePhase.Lobby;
    room.round = 0;
    room.phaseEndsAt = null;
    room.updatedAt = Date.now();
    for (const p of room.players.values()) {
      p.status = PlayerStatus.Alive;
      p.isReady = false;
    }
    this.broadcast(room);
  }

  // -------------------------------------------------------------------------
  // Phase scheduling
  // -------------------------------------------------------------------------

  private enterPhase(room: RoomEntity, phase: GamePhase): void {
    const game = room.game;
    if (!game) return;
    this.clearTimer(room);

    room.phase = phase;
    const durations = room.settings.phaseDurations;
    let seconds = 0;
    switch (phase) {
      case GamePhase.RoleReveal:
        seconds = durations.roleReveal;
        break;
      case GamePhase.Night:
        seconds = durations.night;
        GameEngine.beginNight(game);
        break;
      case GamePhase.Day:
        seconds = durations.day;
        break;
      case GamePhase.Voting:
        seconds = durations.voting;
        GameEngine.beginVoting(game);
        break;
      case GamePhase.Elimination:
        seconds = durations.elimination;
        break;
      default:
        seconds = 0;
    }

    room.phaseEndsAt = seconds > 0 ? Date.now() + seconds * 1000 : null;
    room.updatedAt = Date.now();
    game.resolving = false;

    this.emitter.phaseChanged(room.code, {
      phase,
      round: room.round,
      phaseEndsAt: room.phaseEndsAt,
      announcement: this.narrate(room, phase),
    });
    this.broadcast(room);

    // Non-blocking AI narration enrichment: the immediate `announcement` above
    // is static and always present; this posts a themed narrator line shortly
    // after, if the model responds within its bounded timeout.
    this.enrichNarration(room, phase);

    // Schedule AI-controlled players' behavior for this phase (night actions,
    // votes, day chatter) with small human-like delays. Purely additive: the
    // phase timer still resolves everything if an AI somehow does not act.
    this.driveAiForPhase(room, phase);

    if (seconds > 0) {
      game.phaseTimer = setTimeout(
        () => this.onPhaseTimeout(room.code, phase, room.round),
        seconds * 1000,
      );
    }
  }

  /**
   * Fire-and-forget themed narration for a phase. Guards against stale games and
   * never throws into the game loop.
   */
  private enrichNarration(room: RoomEntity, phase: GamePhase): void {
    const beat = AiGameMasterService.beatForPhase(phase);
    if (!beat) return;
    const game = room.game;
    if (!game) return;
    const round = room.round;
    void this.ai
      .narrate(room.settings.themeId, beat, { seed: round })
      .then((line) => {
        const current = this.store.get(room.code);
        // Only post if we are still in the same phase/round of the same game.
        if (
          !current ||
          current.game !== game ||
          current.phase !== phase ||
          current.round !== round
        ) {
          return;
        }
        this.systemLine(room, line);
      })
      .catch(() => undefined);
  }

  private onPhaseTimeout(code: string, phase: GamePhase, round: number): void {
    const room = this.store.get(code);
    if (!room || !room.game) return;
    // Ignore stale timers from a previous phase/round.
    if (room.phase !== phase || room.round !== round) return;
    this.advance(room);
  }

  // -------------------------------------------------------------------------
  // AI-controlled players (Phase 5)
  // -------------------------------------------------------------------------

  /** Living AI players in seat order. */
  private livingAi(room: RoomEntity): string[] {
    const game = room.game;
    if (!game) return [];
    return [...room.players.values()]
      .filter((p) => p.kind === PlayerKind.Ai && game.alive.has(p.id))
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.id);
  }

  /** Schedule a timer that auto-cancels if the phase/round/game changed. */
  private aiSchedule(
    room: RoomEntity,
    phase: GamePhase,
    round: number,
    delayMs: number,
    fn: () => void,
  ): void {
    const game = room.game;
    if (!game) return;
    const timer = setTimeout(() => {
      game.aiTimers.delete(timer);
      const current = this.store.get(room.code);
      if (!current || current.game !== game) return;
      if (current.phase !== phase || current.round !== round) return;
      try {
        fn();
      } catch (err) {
        this.logger.debug(`AI action skipped: ${(err as Error)?.message}`);
      }
    }, delayMs);
    game.aiTimers.add(timer);
  }

  /** Dispatch AI behavior appropriate to the phase. */
  private driveAiForPhase(room: RoomEntity, phase: GamePhase): void {
    const game = room.game;
    if (!game) return;
    const round = room.round;

    if (phase === GamePhase.Night) {
      for (const id of this.livingAi(room)) {
        const role = game.roles.get(id);
        if (!role) continue;
        // Townsperson AI has no night action — skip silently.
        const delay = 1500 + Math.floor(Math.random() * 4000);
        this.aiSchedule(room, phase, round, delay, () => {
          if (game.night.submitted.has(id)) return;
          const memory = game.investigations.get(id);
          const target = this.aiPlayer.decideNightTarget(game, id, memory);
          try {
            this.submitNightAction(room, id, target);
          } catch {
            // If the heuristic target was somehow illegal, submit a skip so the
            // night can still resolve on time.
            try {
              this.submitNightAction(room, id, null);
            } catch {
              /* already resolved */
            }
          }
        });
      }
    } else if (phase === GamePhase.Voting) {
      for (const id of this.livingAi(room)) {
        const delay = 2000 + Math.floor(Math.random() * 5000);
        this.aiSchedule(room, phase, round, delay, () => {
          if (game.votes.has(id)) return;
          const target = this.aiPlayer.decideVote(game, id, {
            knownMafiaResults: game.investigations.get(id),
            tally: this.tally(room).counts,
            personalityId: room.players.get(id)?.personalityId,
          });
          try {
            this.submitVote(room, id, target);
          } catch {
            /* vote window closed */
          }
        });
      }
    } else if (phase === GamePhase.Day) {
      // A few AI contribute a themed chat line, staggered through the day.
      const speakers = this.livingAi(room).filter((id) =>
        this.aiPlayer.shouldSpeak(room.players.get(id)?.personalityId),
      );
      const theme = getTheme(room.settings.themeId);
      speakers.forEach((id, i) => {
        const delay = 2500 + i * 3500 + Math.floor(Math.random() * 2000);
        this.aiSchedule(room, phase, round, delay, () => {
          const self = room.players.get(id);
          if (!self) return;
          const livingNames = [...room.players.values()]
            .filter((p) => game.alive.has(p.id))
            .map((p) => p.displayName);
          void this.aiPlayer
            .chatLine({
              personalityId: self.personalityId,
              selfName: self.displayName,
              livingNames,
              themeBlurb: theme.blurb,
              round,
            })
            .then((line) => {
              const current = this.store.get(room.code);
              if (
                !current ||
                current.game !== game ||
                current.phase !== GamePhase.Day ||
                current.round !== round ||
                !game.alive.has(id)
              ) {
                return;
              }
              this.emitter.systemMessage(room.code, {
                id: generateMessageId(),
                roomCode: room.code,
                authorId: id,
                authorName: self.displayName,
                text: line,
                at: Date.now(),
                system: false,
              });
            })
            .catch(() => undefined);
        });
      });
    }
  }

  private clearAiTimers(game: GameState): void {
    for (const t of game.aiTimers) clearTimeout(t);
    game.aiTimers.clear();
  }

  /** Advance from the current phase to the next, resolving as needed. */
  private advance(room: RoomEntity): void {
    const game = room.game;
    if (!game || game.resolving) return;
    game.resolving = true;

    switch (room.phase) {
      case GamePhase.RoleReveal:
        this.enterPhase(room, GamePhase.Night);
        break;
      case GamePhase.Night:
        this.resolveNightAndContinue(room);
        break;
      case GamePhase.Day:
        this.enterPhase(room, GamePhase.Voting);
        break;
      case GamePhase.Voting:
        this.resolveVotingAndContinue(room);
        break;
      case GamePhase.Elimination:
        // Elimination is a short display phase; loop back to night if no winner.
        this.enterPhase(room, GamePhase.Night);
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Night
  // -------------------------------------------------------------------------

  submitNightAction(
    room: RoomEntity,
    playerId: string,
    targetId: string | null,
  ): void {
    const game = this.requireGame(room);
    if (room.phase !== GamePhase.Night)
      throw new RoomError(ErrorCode.WrongPhase, 'It is not night');
    if (room.phaseEndsAt && Date.now() > room.phaseEndsAt)
      throw new RoomError(ErrorCode.DeadlinePassed, 'The night has ended');

    const res = GameEngine.submitNightAction(game, playerId, targetId);
    if (!res.ok) throw new RoomError(ErrorCode.ActionNotAllowed, res.reason);

    // Early resolution once every night actor has submitted.
    if (GameEngine.allNightActionsIn(game) && !game.resolving) {
      this.advance(room);
    }
  }

  private resolveNightAndContinue(room: RoomEntity): void {
    const game = room.game!;
    const resolution = GameEngine.resolveNight(game);

    // Private: detective learns their result.
    if (resolution.investigation) {
      const detectiveId = this.findActor(game, Role.Detective);
      if (detectiveId) {
        // Record into this detective's private memory (used by AI detectives to
        // act/vote on what THEY personally learned; never shared with others).
        let mem = game.investigations.get(detectiveId);
        if (!mem) {
          mem = new Map<string, boolean>();
          game.investigations.set(detectiveId, mem);
        }
        mem.set(resolution.investigation.targetId, resolution.investigation.isMafia);

        this.emitter.investigationResult(detectiveId, {
          round: room.round,
          targetId: resolution.investigation.targetId,
          result: resolution.investigation.isMafia ? 'MAFIA' : 'NOT_MAFIA',
        });
      }
    }

    // Apply death to the public player record.
    if (resolution.killedId) {
      const victim = room.players.get(resolution.killedId);
      if (victim) victim.status = PlayerStatus.Dead;
    }

    // Enter the elimination/announcement display, then check win.
    room.phase = GamePhase.Elimination;
    const elimPayload = {
      eliminatedId: resolution.killedId,
      reason: resolution.killedId ? ('MAFIA_KILL' as const) : ('NONE' as const),
      revealedRole:
        resolution.killedId && room.settings.revealRoleOnElimination
          ? game.roles.get(resolution.killedId)
          : undefined,
    };
    this.emitter.playerEliminated(room.code, elimPayload);

    const announcement = resolution.killedId
      ? `${this.nameOf(room, resolution.killedId)} was found dead at dawn.`
      : resolution.savedByDoctor
        ? 'A victim was targeted overnight, but survived.'
        : 'The night passed quietly. No one died.';
    GameEngine.addTimeline(game, GamePhase.Elimination, announcement);
    this.systemLine(room, announcement);

    if (this.checkAndMaybeEnd(room)) return;

    // Show the elimination briefly, then begin the day.
    this.emitter.phaseChanged(room.code, {
      phase: GamePhase.Elimination,
      round: room.round,
      phaseEndsAt: Date.now() + room.settings.phaseDurations.elimination * 1000,
      announcement,
    });
    this.broadcast(room);
    this.scheduleAfter(room, room.settings.phaseDurations.elimination, () => {
      room.round += 1;
      this.enterPhase(room, GamePhase.Day);
    });
  }

  // -------------------------------------------------------------------------
  // Voting
  // -------------------------------------------------------------------------

  submitVote(
    room: RoomEntity,
    voterId: string,
    targetId: string | null,
  ): void {
    const game = this.requireGame(room);
    if (room.phase !== GamePhase.Voting)
      throw new RoomError(ErrorCode.WrongPhase, 'It is not voting time');
    if (room.phaseEndsAt && Date.now() > room.phaseEndsAt)
      throw new RoomError(ErrorCode.DeadlinePassed, 'Voting has ended');

    const res = GameEngine.submitVote(
      game,
      voterId,
      targetId,
      room.settings.allowVoteChange,
    );
    if (!res.ok) throw new RoomError(ErrorCode.ActionNotAllowed, res.reason);

    this.emitter.voteUpdated(room.code, this.tally(room));

    if (GameEngine.allVotesIn(game) && !game.resolving) {
      this.advance(room);
    }
  }

  private resolveVotingAndContinue(room: RoomEntity): void {
    const game = room.game!;
    const resolution = GameEngine.resolveVotes(game);

    if (resolution.eliminatedId) {
      const victim = room.players.get(resolution.eliminatedId);
      if (victim) victim.status = PlayerStatus.Dead;
    }

    room.phase = GamePhase.Elimination;
    const reason = resolution.eliminatedId
      ? ('VOTE' as const)
      : ('TIE_NO_ELIMINATION' as const);
    this.emitter.playerEliminated(room.code, {
      eliminatedId: resolution.eliminatedId,
      reason,
      revealedRole:
        resolution.eliminatedId && room.settings.revealRoleOnElimination
          ? game.roles.get(resolution.eliminatedId)
          : undefined,
    });

    const announcement = resolution.eliminatedId
      ? `The town voted to eliminate ${this.nameOf(room, resolution.eliminatedId)}.`
      : 'The vote was tied. No one was eliminated.';
    GameEngine.addTimeline(game, GamePhase.Elimination, announcement);
    this.systemLine(room, announcement);

    if (this.checkAndMaybeEnd(room)) return;

    this.emitter.phaseChanged(room.code, {
      phase: GamePhase.Elimination,
      round: room.round,
      phaseEndsAt: Date.now() + room.settings.phaseDurations.elimination * 1000,
      announcement,
    });
    this.broadcast(room);
    this.scheduleAfter(room, room.settings.phaseDurations.elimination, () => {
      room.round += 1;
      this.enterPhase(room, GamePhase.Night);
    });
  }

  // -------------------------------------------------------------------------
  // Win detection + endgame
  // -------------------------------------------------------------------------

  /** Returns true if the game ended (and emits game:finished). */
  private checkAndMaybeEnd(room: RoomEntity): boolean {
    const game = room.game!;
    const winner = GameEngine.winner(game);
    if (!winner) return false;

    this.clearTimer(room);
    game.winner = winner;
    room.phase = GamePhase.GameOver;
    room.phaseEndsAt = null;
    room.updatedAt = Date.now();

    const roles = [...game.roles.entries()].map(([playerId, role]) => ({
      playerId,
      role,
      team: ROLE_TEAM[role],
    }));
    const summary =
      winner === Team.Town
        ? 'The Town rooted out the Mafia and restored peace.'
        : 'The Mafia seized control under cover of night.';
    GameEngine.addTimeline(game, GamePhase.GameOver, summary);

    this.emitter.gameFinished(room.code, { winningTeam: winner, roles, summary });
    this.broadcast(room);
    this.logger.log(`Room ${room.code} finished: ${winner} win`);
    return true;
  }

  // -------------------------------------------------------------------------
  // Disconnect handling
  // -------------------------------------------------------------------------

  /**
   * Called when a player disconnects mid-game. We keep their seat (reconnection
   * grace) but if an unresponsive player is blocking a phase, the phase timer
   * still resolves it, so no special action is required here beyond re-checking
   * early-resolution conditions.
   */
  onPlayerConnectivityChanged(room: RoomEntity): void {
    const game = room.game;
    if (!game || game.resolving) return;
    if (room.phase === GamePhase.Night && GameEngine.allNightActionsIn(game)) {
      this.advance(room);
    } else if (room.phase === GamePhase.Voting && GameEngine.allVotesIn(game)) {
      this.advance(room);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Build the public vote tally (who voted, not their choice, plus counts). */
  tally(room: RoomEntity): {
    counts: Record<string, number>;
    voted: string[];
    totalEligible: number;
  } {
    const game = room.game!;
    const counts: Record<string, number> = {};
    for (const target of game.votes.values()) {
      const key = target ?? 'ABSTAIN';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return {
      counts,
      voted: [...game.votes.keys()],
      totalEligible: game.alive.size,
    };
  }

  private findActor(game: GameState, role: Role): string | null {
    for (const [id, r] of game.roles.entries()) {
      if (r === role && game.alive.has(id)) return id;
    }
    return null;
  }

  private narrate(room: RoomEntity, phase: GamePhase): string | undefined {
    const theme = getTheme(room.settings.themeId);
    switch (phase) {
      case GamePhase.RoleReveal:
        return `${theme.name}. ${theme.blurb}`;
      case GamePhase.Night:
        return theme.fallback.night;
      case GamePhase.Day:
        return theme.fallback.day;
      case GamePhase.Voting:
        return theme.fallback.voting;
      default:
        return undefined;
    }
  }

  private nameOf(room: RoomEntity, playerId: string): string {
    return room.players.get(playerId)?.displayName ?? 'A player';
  }

  private systemLine(room: RoomEntity, text: string): void {
    this.emitter.systemMessage(room.code, {
      id: generateMessageId(),
      roomCode: room.code,
      authorId: null,
      authorName: 'Narrator',
      text,
      at: Date.now(),
      system: true,
    });
  }

  private scheduleAfter(
    room: RoomEntity,
    seconds: number,
    fn: () => void,
  ): void {
    const game = room.game;
    if (!game) return;
    this.clearTimer(room);
    const round = room.round;
    const phase = room.phase;
    game.phaseTimer = setTimeout(
      () => {
        const current = this.store.get(room.code);
        if (!current || !current.game) return;
        if (current.phase !== phase || current.round !== round) return;
        fn();
      },
      Math.max(0, seconds) * 1000,
    );
  }

  private clearTimer(room: RoomEntity): void {
    if (room.game?.phaseTimer) {
      clearTimeout(room.game.phaseTimer);
      room.game.phaseTimer = null;
    }
    // Also cancel any pending AI action timers so they can't fire into a new
    // phase/game after a transition, win, or rematch.
    if (room.game) this.clearAiTimers(room.game);
  }

  private broadcast(room: RoomEntity): void {
    this.emitter.roomUpdated(room.code, toPublicRoomState(room));
  }

  private requireGame(room: RoomEntity): GameState {
    if (!room.game) throw new RoomError(ErrorCode.WrongPhase, 'No game in progress');
    return room.game;
  }
}
