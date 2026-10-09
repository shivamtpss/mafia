import { Role, RoomSettings } from './types';

/** Supported player counts for a single room. */
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;

/** Room code format: unambiguous uppercase chars (no O/0/I/1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

export const AVATARS = [
  'fox',
  'owl',
  'wolf',
  'raven',
  'cat',
  'bear',
  'snake',
  'stag',
  'hare',
  'moth',
  'lynx',
  'crow',
] as const;
export type Avatar = (typeof AVATARS)[number];

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  phaseDurations: {
    roleReveal: 8,
    night: 40,
    day: 90,
    voting: 45,
    elimination: 8,
  },
  revealRoleOnElimination: true,
  allowVoteChange: true,
};

/**
 * Deterministic role distribution by player count.
 * Returns the exact multiset of roles to assign. The server shuffles seats, not
 * the counts, so balance is predictable and testable.
 */
export function roleDistribution(playerCount: number): Record<Role, number> {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(
      `playerCount ${playerCount} out of supported range ${MIN_PLAYERS}-${MAX_PLAYERS}`,
    );
  }

  // Mafia count scales ~ 1 per 3-4 players.
  const mafia = playerCount <= 6 ? 1 : playerCount <= 9 ? 2 : 3;

  // Town power roles.
  const detective = 1;
  const doctor = playerCount >= 6 ? 1 : 0;

  const special = mafia + detective + doctor;
  const townspeople = playerCount - special;

  if (townspeople < 0) {
    throw new Error(`invalid role distribution for ${playerCount} players`);
  }

  return {
    [Role.Mafia]: mafia,
    [Role.Detective]: detective,
    [Role.Doctor]: doctor,
    [Role.Townsperson]: townspeople,
  };
}

/** Flatten a distribution into an array of roles (unshuffled). */
export function roleBag(playerCount: number): Role[] {
  const dist = roleDistribution(playerCount);
  const bag: Role[] = [];
  (Object.keys(dist) as Role[]).forEach((role) => {
    for (let i = 0; i < dist[role]; i++) bag.push(role);
  });
  return bag;
}
