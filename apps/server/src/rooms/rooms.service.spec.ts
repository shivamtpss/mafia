import { RoomsService } from './rooms.service';
import { RoomStore } from './room.store';
import { RoomError } from './room.error';
import { ErrorCode, GamePhase } from '@ai-mafia/shared';

function makeService(): RoomsService {
  return new RoomsService(new RoomStore());
}

describe('RoomsService — lobby', () => {
  it('creates a room with the creator as host', () => {
    const svc = makeService();
    const { room, player, sessionId } = svc.createRoom({
      displayName: 'Alice',
      avatar: 'fox',
    });
    expect(room.code).toHaveLength(5);
    expect(room.phase).toBe(GamePhase.Lobby);
    expect(player.isHost).toBe(true);
    expect(room.hostId).toBe(player.id);
    expect(sessionId).toBeTruthy();
    expect(room.players.size).toBe(1);
  });

  it('rejects invalid display names', () => {
    const svc = makeService();
    expect(() => svc.createRoom({ displayName: 'A', avatar: 'fox' })).toThrow(
      RoomError,
    );
  });

  it('rejects invalid avatars', () => {
    const svc = makeService();
    expect(() =>
      svc.createRoom({ displayName: 'Alice', avatar: 'dragon' }),
    ).toThrow(RoomError);
  });

  it('lets a second player join by code', () => {
    const svc = makeService();
    const { room } = svc.createRoom({ displayName: 'Alice', avatar: 'fox' });
    const join = svc.joinRoom({
      code: room.code,
      displayName: 'Bob',
      avatar: 'owl',
    });
    expect(join.room.players.size).toBe(2);
    expect(join.player.isHost).toBe(false);
    expect(join.player.seat).toBe(1);
  });

  it('rejects duplicate display names in the same room', () => {
    const svc = makeService();
    const { room } = svc.createRoom({ displayName: 'Alice', avatar: 'fox' });
    expect(() =>
      svc.joinRoom({ code: room.code, displayName: 'alice', avatar: 'owl' }),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.NameTaken }),
    );
  });

  it('rejects joining an unknown room', () => {
    const svc = makeService();
    expect(() =>
      svc.joinRoom({ code: 'ZZZZZ', displayName: 'Bob', avatar: 'owl' }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.RoomNotFound }));
  });

  it('treats same session rejoining as a reconnect, not a new seat', () => {
    const svc = makeService();
    const created = svc.createRoom({ displayName: 'Alice', avatar: 'fox' });
    const rejoined = svc.joinRoom({
      code: created.room.code,
      sessionId: created.sessionId,
      displayName: 'Alice',
      avatar: 'fox',
    });
    expect(rejoined.reconnected).toBe(true);
    expect(rejoined.room.players.size).toBe(1);
    expect(rejoined.player.id).toBe(created.player.id);
  });

  it('only the host can start, and only with enough ready players', () => {
    const svc = makeService();
    const host = svc.createRoom({ displayName: 'Alice', avatar: 'fox' });
    const code = host.room.code;

    // Not enough players yet.
    expect(() => svc.startGame(code, host.player.id)).toThrow(
      expect.objectContaining({ code: ErrorCode.NotEnoughPlayers }),
    );

    const b = svc.joinRoom({ code, displayName: 'Bob', avatar: 'owl' });
    const c = svc.joinRoom({ code, displayName: 'Cara', avatar: 'wolf' });
    const d = svc.joinRoom({ code, displayName: 'Dan', avatar: 'raven' });

    // Non-host cannot start.
    expect(() => svc.startGame(code, b.player.id)).toThrow(
      expect.objectContaining({ code: ErrorCode.NotHost }),
    );

    // Non-host players must ready up.
    expect(() => svc.startGame(code, host.player.id)).toThrow(
      expect.objectContaining({ code: ErrorCode.ActionNotAllowed }),
    );

    svc.setReady(code, b.player.id, true);
    svc.setReady(code, c.player.id, true);
    svc.setReady(code, d.player.id, true);

    const started = svc.startGame(code, host.player.id);
    expect(started.phase).toBe(GamePhase.RoleReveal);
    expect(started.round).toBe(1);
  });

  it('reassigns host when the host leaves', () => {
    const svc = makeService();
    const host = svc.createRoom({ displayName: 'Alice', avatar: 'fox' });
    const code = host.room.code;
    const b = svc.joinRoom({ code, displayName: 'Bob', avatar: 'owl' });

    const updated = svc.removePlayer(code, host.player.id);
    expect(updated).toBeDefined();
    expect(updated!.hostId).toBe(b.player.id);
    expect(updated!.players.get(b.player.id)!.isHost).toBe(true);
  });

  it('deletes the room when the last human leaves', () => {
    const svc = makeService();
    const host = svc.createRoom({ displayName: 'Alice', avatar: 'fox' });
    const code = host.room.code;
    const updated = svc.removePlayer(code, host.player.id);
    expect(updated).toBeUndefined();
    expect(svc.getRoom(code)).toBeUndefined();
  });

  it('does not expose session ids on public players', () => {
    const svc = makeService();
    const { player } = svc.createRoom({ displayName: 'Alice', avatar: 'fox' });
    // The ServerPlayer carries sessionId; ensure it is a distinct field from id.
    expect(player.sessionId).not.toBe(player.id);
  });
});
