import { type PrismaClient } from "@prisma/client";

/**
 * A populated game in the exact shape written by the pre-PR02 application
 * (`ffa2cf1`), inserted with raw SQL so later schema changes cannot alter what
 * "legacy" means. Upgrade tests apply migrations on top of it.
 *
 * Team game history: 0 -> A10 -> A10/B5 -> A30/B5, then two legacy undos, so
 * the current score is A10 and the redo stack is [s2, s3] (legacy `undoScore`
 * prepended to `futureStateIds`).
 */
export const LEGACY = {
  hostUserId: "legacy-user-host",
  playerUserId: "legacy-user-player",
  teamGame: {
    id: "legacy-game-team",
    code: "LEGAC1",
    teamA: "legacy-team-a",
    teamB: "legacy-team-b",
    players: ["legacy-gu-1", "legacy-gu-2", "legacy-gu-3"],
    scoreboardId: "legacy-sb-team",
    states: {
      s0: "legacy-ss-0",
      s1: "legacy-ss-1",
      s2: "legacy-ss-2",
      s3: "legacy-ss-3",
    },
  },
  individualGame: {
    id: "legacy-game-indiv",
    code: "LEGAC2",
    player: "legacy-gu-4",
    team: "legacy-team-indiv",
    scoreboardId: "legacy-sb-indiv",
    state: "legacy-ss-indiv",
  },
} as const;

export const LEGACY_EXPECTED = {
  teamScores: { [LEGACY.teamGame.teamA]: 10 } as Record<string, number>,
  pastStateIds: [LEGACY.teamGame.states.s0],
  futureStateIds: [LEGACY.teamGame.states.s2, LEGACY.teamGame.states.s3],
  individualScores: { [LEGACY.individualGame.team]: 3 } as Record<
    string,
    number
  >,
};

export async function seedLegacyFixture(client: PrismaClient) {
  const t = LEGACY.teamGame;
  const i = LEGACY.individualGame;
  const json = (value: unknown) => JSON.stringify(value);

  const statements = [
    `INSERT INTO "User" (id, name, email, "updatedAt") VALUES
      ('${LEGACY.hostUserId}', 'Legacy Host', 'legacy-host@example.test', now()),
      ('${LEGACY.playerUserId}', 'Legacy Player', 'legacy-player@example.test', now())`,

    `INSERT INTO "Game" (id, name, code, "isBuzzerListening", settings, format, "createdById", "updatedAt") VALUES
      ('${t.id}', 'Legacy Team Game', '${t.code}', false, '${json({ freezeTeams: true })}', 'team', '${LEGACY.hostUserId}', now()),
      ('${i.id}', 'Legacy Individual Game', '${i.code}', true, '{}', 'individual', '${LEGACY.hostUserId}', now())`,

    `INSERT INTO "GameAdmin" (id, "userId", "gameId") VALUES
      ('legacy-admin-team', '${LEGACY.hostUserId}', '${t.id}'),
      ('legacy-admin-indiv', '${LEGACY.hostUserId}', '${i.id}')`,

    `INSERT INTO "GameTeam" (id, index, name, "gameId", "buzzerState") VALUES
      ('${t.teamA}', 1, 'Team 1', '${t.id}', 'selected'),
      ('${t.teamB}', 2, 'Renamed Team', '${t.id}', 'rejected'),
      ('${i.team}', 1, 'Solo', '${i.id}', 'available')`,

    `INSERT INTO "GameUser" (id, name, index, "gameId", "gameTeamId", "userId", token, "updatedAt") VALUES
      ('${t.players[0]}', 'Player 1', 1, '${t.id}', '${t.teamA}', NULL, 'legacy-token-1', now()),
      ('${t.players[1]}', 'Legacy Player', 2, '${t.id}', '${t.teamA}', '${LEGACY.playerUserId}', 'legacy-token-2', now()),
      ('${t.players[2]}', 'Player 3', 3, '${t.id}', '${t.teamB}', NULL, 'legacy-token-3', now()),
      ('${i.player}', 'Solo', 1, '${i.id}', '${i.team}', NULL, 'legacy-token-4', now())`,

    `INSERT INTO "Scoreboard" (id, "gameId") VALUES
      ('${t.scoreboardId}', '${t.id}'),
      ('${i.scoreboardId}', '${i.id}')`,

    `INSERT INTO "ScoreboardState" (id, "gameId", "scoreboardId", state) VALUES
      ('${t.states.s0}', '${t.id}', '${t.scoreboardId}', '{}'),
      ('${t.states.s1}', '${t.id}', '${t.scoreboardId}', '${json({ [t.teamA]: 10 })}'),
      ('${t.states.s2}', '${t.id}', '${t.scoreboardId}', '${json({ [t.teamA]: 10, [t.teamB]: 5 })}'),
      ('${t.states.s3}', '${t.id}', '${t.scoreboardId}', '${json({ [t.teamA]: 30, [t.teamB]: 5 })}'),
      ('${i.state}', '${i.id}', '${i.scoreboardId}', '${json({ [i.team]: 3 })}')`,

    `UPDATE "Scoreboard" SET "currentStateId" = '${t.states.s1}',
      "pastStateIds" = '${json([t.states.s0])}',
      "futureStateIds" = '${json([t.states.s2, t.states.s3])}'
      WHERE id = '${t.scoreboardId}'`,

    `UPDATE "Scoreboard" SET "currentStateId" = '${i.state}' WHERE id = '${i.scoreboardId}'`,
  ];

  for (const statement of statements) {
    await client.$executeRawUnsafe(statement);
  }
}

/** Reads back the legacy-owned columns for before/after comparisons. */
export async function snapshotLegacyData(client: PrismaClient) {
  const [games, teams, users, admins, scoreboards, states] = await Promise.all([
    client.$queryRawUnsafe(
      `SELECT id, name, code, "isBuzzerListening", settings, format, "createdById" FROM "Game" ORDER BY id`,
    ),
    client.$queryRawUnsafe(
      `SELECT id, index, name, "gameId", "buzzerState" FROM "GameTeam" ORDER BY id`,
    ),
    client.$queryRawUnsafe(
      `SELECT id, name, index, "gameId", "gameTeamId", "userId", token FROM "GameUser" ORDER BY id`,
    ),
    client.$queryRawUnsafe(
      `SELECT id, "userId", "gameId" FROM "GameAdmin" ORDER BY id`,
    ),
    client.$queryRawUnsafe(
      `SELECT id, "gameId", "currentStateId", "pastStateIds", "futureStateIds" FROM "Scoreboard" ORDER BY id`,
    ),
    client.$queryRawUnsafe(
      `SELECT id, "gameId", "scoreboardId", state FROM "ScoreboardState" ORDER BY id`,
    ),
  ]);
  return { games, teams, users, admins, scoreboards, states };
}
