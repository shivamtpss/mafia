import { GameService } from './game.service';
import { GameEmitter } from './game.emitter';
import { RoomStore } from '../rooms/room.store';
import { RoomsService } from '../rooms/rooms.service';
import { RoomEntity } from '../rooms/room.entity';
import {
  ChatMessage,
  EliminationPayload,
  GameFinishedPayload,
  GamePhase,
  InvestigationResultPayload,
  PhaseChangedPayload,
  PrivateRoleInfo,
  PublicRoomState,
  Role,
  Team,
  VoteTally,
} from '@ai-mafia/shared';

/** Records everything the service emits for assertions. */
class FakeEmitter implements GameEmitter {
  roomUpdates: PublicRoomState[] = [];
  phases: PhaseChangedPayload[] = [];
  roles = new Map<string, PrivateRoleInfo>();
  investigations: Array<{ playerId: string; p: InvestigationResultPayload }> = [];
  systemMessages: ChatMessage[] = [];
  tallies: VoteTally[] = [];
  eliminations: EliminationPayload[] = [];
  finished: GameFinishedPayload | null = null;

  roomUpdated(_c: string, room: PublicRoomState) { this.roomUpdates.push(room); }
  phaseChanged(_c: string, p: PhaseChangedPayload) { this.phases.push(p); }
  roleAssigned(playerId: string, info: PrivateRoleInfo) { this.roles.set(playerId, info); }
  investigationResult(playerId: string, p: InvestigationResultPayload) { this.investigations.push({ playerId, p }); }
  systemMessage(_c: string, m: ChatMessage) { this.systemMessages.push(m); }
  voteUpdated(_c: string, t: VoteTally) { this.tallies.push(t); }
  playerEliminated(_c: string, p: EliminationPayload) { this.eliminations.push(p); }
  gameFinished(_c: string, p: GameFinishedPayload) { this.finished = p; }
}

/** Create a room with N ready human players via the real RoomsService. */
function makeRoom(store: RoomStore, rooms: RoomsService, n: number): RoomEntity {
  const host = rooms.createRoom({ displayName: 'Host', avatar: 'fox' });
  const code = host.room.code;
  const avatars = ['owl', 'wolf', 'raven', 'cat', 'bear', 'snake', 'stag'];
  for (let i = 1; i < n; i++) {
    const j = rooms.joinRoom({ code, displayName: `P${i}`, avatar: avatars[i - 1] });
    rooms.setReady(code, j.player.id, true);
  }
  return store.get(code)!;
}

function idByRole(room: RoomEntity, role: Role): string[] {
  const game = room.game!;
  return [...game.roles.entries()].filter(([, r]) => r === role).map(([id]) => id);
}

describe('GameService — orchestration', () => {
  let store: RoomStore;
  let rooms: RoomsService;
  let service: GameService;
  let emitter: FakeEmitter;

  beforeEach(() => {
    jest.useFakeTimers();
    store = new RoomStore();
    rooms = new RoomsService(store);
    service = new GameService(store);
    emitter = new FakeEmitter();
    service.registerEmitter(emitter);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('assigns a private role to every player and never broadcasts roles', () => {
    const room = makeRoom(store, rooms, 4);
    service.startGame(room, () => 0);

    // Each of the 4 players received exactly one private role.
    expect(emitter.roles.size).toBe(4);
    for (const p of room.players.values()) {
      expect(emitter.roles.has(p.id)).toBe(true);
    }
    // The public room snapshots never contain role/team fields.
    for (const snap of emitter.roomUpdates) {
      for (const pp of snap.players) {
        expect((pp as Record<string, unknown>).role).toBeUndefined();
        expect((pp as Record<string, unknown>).team).toBeUndefined();
      }
    }
  });

  it('only mafia receive ally lists', () => {
    const room = makeRoom(store, rooms, 8);
    service.startGame(room, () => 0);
    for (const [playerId, info] of emitter.roles.entries()) {
      if (info.role === Role.Mafia) {
        expect(Array.isArray(info.allies)).toBe(true);
        expect(info.allies).not.toContain(playerId);
      } else {
        expect(info.allies).toBeUndefined();
      }
    }
  });

  it('plays a full game to a Town win with deterministic actions', () => {
    const room = makeRoom(store, rooms, 4);
    service.startGame(room, () => 0);
    const game = room.game!;
    const mafia = idByRole(room, Role.Mafia)[0];
    const detective = idByRole(room, Role.Detective)[0];
    const town = [...game.roles.keys()].filter(
      (id) => game.roles.get(id) !== Role.Mafia,
    );

    // Advance role-reveal timer -> night.
    jest.advanceTimersByTime(room.settings.phaseDurations.roleReveal * 1000);
    expect(room.phase).toBe(GamePhase.Night);

    // Night 1: mafia kills a townsperson (pick a non-mafia, non-detective if any).
    const victim = town.find((id) => id !== detective) ?? town[0];
    service.submitNightAction(room, mafia, victim);
    // Detective investigates the mafia.
    service.submitNightAction(room, detective, mafia);
    // Doctor (if present at 4p there is none) — 4 players => no doctor.

    // All night actors submitted -> resolves immediately to Elimination.
    expect(room.phase).toBe(GamePhase.Elimination);
    expect(emitter.eliminations.some((e) => e.eliminatedId === victim)).toBe(true);

    // Detective learned the mafia identity privately.
    const inv = emitter.investigations.find((i) => i.playerId === detective);
    expect(inv?.p.result).toBe('MAFIA');

    // Elimination display -> day.
    jest.advanceTimersByTime(room.settings.phaseDurations.elimination * 1000);
    expect(room.phase).toBe(GamePhase.Day);

    // Day -> voting.
    jest.advanceTimersByTime(room.settings.phaseDurations.day * 1000);
    expect(room.phase).toBe(GamePhase.Voting);

    // Everyone alive votes out the mafia.
    for (const voter of [...game.alive]) {
      service.submitVote(room, voter, mafia);
    }
    // All votes in -> resolves; mafia eliminated -> Town wins -> GameOver.
    expect(room.phase).toBe(GamePhase.GameOver);
    expect(emitter.finished?.winningTeam).toBe(Team.Town);
    // Full role reveal only at game end.
    expect(emitter.finished?.roles.length).toBe(4);
  });

  it('rejects night actions outside the night phase', () => {
    const room = makeRoom(store, rooms, 4);
    service.startGame(room, () => 0);
    const mafia = idByRole(room, Role.Mafia)[0];
    const other = [...room.game!.alive].find((id) => id !== mafia)!;
    // Still in RoleReveal.
    expect(() => service.submitNightAction(room, mafia, other)).toThrow();
  });

  it('rejects votes outside the voting phase', () => {
    const room = makeRoom(store, rooms, 4);
    service.startGame(room, () => 0);
    const a = [...room.game!.alive][0];
    const b = [...room.game!.alive][1];
    expect(() => service.submitVote(room, a, b)).toThrow();
  });

  it('doctor save prevents a night death (6 players)', () => {
    const room = makeRoom(store, rooms, 6);
    service.startGame(room, () => 0);
    const mafia = idByRole(room, Role.Mafia)[0];
    const doctor = idByRole(room, Role.Doctor)[0];

    jest.advanceTimersByTime(room.settings.phaseDurations.roleReveal * 1000);
    expect(room.phase).toBe(GamePhase.Night);

    service.submitNightAction(room, mafia, doctor); // mafia targets the doctor
    service.submitNightAction(room, doctor, doctor); // doctor self-saves
    const detective = idByRole(room, Role.Detective)[0];
    service.submitNightAction(room, detective, mafia);

    // Night resolves; nobody died (saved).
    const lastElim = emitter.eliminations[emitter.eliminations.length - 1];
    expect(lastElim.eliminatedId).toBeNull();
    expect(room.game!.alive.has(doctor)).toBe(true);
  });

  it('rematch returns the room to the lobby and clears secret state', () => {
    const room = makeRoom(store, rooms, 4);
    service.startGame(room, () => 0);
    expect(room.game).toBeDefined();
    // Force game over via rematch path requires GameOver; simulate by ending.
    // Instead, directly test rematch clears state from any phase.
    service.rematch(room);
    expect(room.game).toBeUndefined();
    expect(room.phase).toBe(GamePhase.Lobby);
    for (const p of room.players.values()) expect(p.isReady).toBe(false);
  });
});
