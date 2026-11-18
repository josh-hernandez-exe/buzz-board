/**
 * T05 (PR03): operation receipts and immutable score-effect evidence written by
 * the shared score writer.
 */
import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  LEGACY,
  LEGACY_EXPECTED,
  seedLegacyFixture,
} from "../support/legacyFixture";
import {
  createGame,
  createUser,
  currentScores,
  db,
  requestCaller,
} from "../support/integration";

const rid = () => randomUUID().replaceAll("-", "");

async function effectsFor(gameId: string) {
  return db.scoreEffect.findMany({
    where: { gameId },
    orderBy: { createdAt: "asc" },
    include: { operation: true },
  });
}

/** Opening balance + every recorded delta must equal the current score. */
async function expectEvidenceMatchesScores(
  gameId: string,
  opening: Record<string, number> = {},
) {
  const effects = await effectsFor(gameId);
  const totals: Record<string, number> = { ...opening };
  for (const e of effects) {
    totals[e.gameTeamId] = (totals[e.gameTeamId] ?? 0) + e.delta;
  }
  const scores = await currentScores(gameId);
  for (const [teamId, score] of Object.entries(scores)) {
    expect(totals[teamId] ?? 0).toBe(score);
  }
}

describe("operation receipts", () => {
  it("applies a retried request once and returns the original result", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;
    const requestId = rid();

    const first = await admin.gameAdmin.addScore({
      requestId,
      changes: { [a]: 5 },
    });
    const retry = await admin.gameAdmin.addScore({
      requestId,
      changes: { [a]: 5 },
    });

    expect(first.replayed).toBe(false);
    expect(retry).toEqual({ ...first, replayed: true });
    expect((await currentScores(game.id))[a]).toBe(5);
    expect(
      await db.gameOperation.count({ where: { gameId: game.id, requestId } }),
    ).toBe(1);
  });

  it("applies concurrent retries of one request exactly once", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;
    const requestId = rid();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        admin.gameAdmin.addScore({ requestId, changes: { [a]: 3 } }),
      ),
    );

    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect((await currentScores(game.id))[a]).toBe(3);
  });

  it("rejects reusing a request ID for a different change", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;
    const requestId = rid();
    await admin.gameAdmin.addScore({ requestId, changes: { [a]: 5 } });

    await expect(
      admin.gameAdmin.addScore({ requestId, changes: { [a]: 6 } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      admin.gameAdmin.setScore({ requestId, changes: { [a]: 5 } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await currentScores(game.id))[a]).toBe(5);
  });

  it("binds a receipt to its actor", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;
    const helper = await createUser("Second Admin");
    await db.gameAdmin.create({ data: { userId: helper.id, gameId: game.id } });
    const helperDesk = requestCaller({ gameId: game.id, user: helper });
    const requestId = rid();
    await admin.gameAdmin.addScore({ requestId, changes: { [a]: 5 } });

    await expect(
      helperDesk.gameAdmin.addScore({ requestId, changes: { [a]: 5 } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await currentScores(game.id))[a]).toBe(5);
  });

  it("scopes request IDs to their game", async () => {
    const first = await createGame();
    const second = await createGame();
    const requestId = rid();

    await first.admin.gameAdmin.addScore({
      requestId,
      changes: { [first.gameTeams[0]!.id]: 1 },
    });
    const other = await second.admin.gameAdmin.addScore({
      requestId,
      changes: { [second.gameTeams[0]!.id]: 1 },
    });

    expect(other.replayed).toBe(false);
  });

  it("records who made each change and what kind it was", async () => {
    const { game, host, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;

    await admin.gameAdmin.addScore({ [a]: 2 });
    await admin.gameAdmin.setScore({ [a]: 9 });
    await admin.gameAdmin.undoScore();
    await admin.gameAdmin.redoScore();

    const operations = await db.gameOperation.findMany({
      where: { gameId: game.id },
      orderBy: { createdAt: "asc" },
    });
    expect(operations.map((o) => o.action)).toEqual([
      "score.add",
      "score.set",
      "score.undo",
      "score.redo",
    ]);
    expect(new Set(operations.map((o) => o.actorUserId))).toEqual(
      new Set([host.id]),
    );
    expect(operations.every((o) => o.requestId.length > 0)).toBe(true);
  });
});

describe("score effects", () => {
  it("records the actual applied delta per unit, not the requested amount", async () => {
    const { game, admin, gameTeams } = await createGame({ teams: 3 });
    const [a, b, c] = gameTeams.map((t) => t.id) as [string, string, string];
    await admin.gameAdmin.addScore({ [a]: 10, [b]: 4 });

    // Set a to its current value (no change), b to 0 and c to -2.
    const { operationId } = await admin.gameAdmin.setScore({
      requestId: rid(),
      changes: { [a]: 10, [b]: 0, [c]: -2 },
    });

    const effects = await db.scoreEffect.findMany({
      where: { operationId },
      orderBy: { gameTeamId: "asc" },
    });
    expect(
      effects.map((e) => [e.gameTeamId, e.delta, e.scoreBefore, e.scoreAfter]),
    ).toEqual(
      [
        [b, -4, 4, 0],
        [c, -2, 0, -2],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    await expectEvidenceMatchesScores(game.id);
  });

  it("records undo and redo as their own effects", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;
    await admin.gameAdmin.addScore({ [a]: 10 });

    const undo = await admin.gameAdmin.undoScore({ requestId: rid() });
    const redo = await admin.gameAdmin.redoScore({ requestId: rid() });

    expect(undo.effects).toEqual([
      { gameTeamId: a, delta: -10, scoreBefore: 10, scoreAfter: 0 },
    ]);
    expect(redo.effects).toEqual([
      { gameTeamId: a, delta: 10, scoreBefore: 0, scoreAfter: 10 },
    ]);
    await expectEvidenceMatchesScores(game.id);
  });

  it("keeps evidence of undone changes after a new change clears the redo branch", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;
    const undone = await admin.gameAdmin.addScore({
      requestId: rid(),
      changes: { [a]: 30 },
    });
    await admin.gameAdmin.undoScore();

    await admin.gameAdmin.addScore({ [a]: 7 });

    const branchEffects = await db.scoreEffect.findMany({
      where: { operationId: undone.operationId },
    });
    expect(branchEffects).toHaveLength(1);
    expect(branchEffects[0]).toMatchObject({ delta: 30, scoreAfter: 30 });
    expect((await currentScores(game.id))[a]).toBe(7);
    await expectEvidenceMatchesScores(game.id);
  });

  it("keeps evidence after its team is removed", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;
    await admin.gameAdmin.addScore({ [a]: 5 });

    await admin.gameAdmin.removeTeam({ gameTeamId: a });

    expect(
      await db.scoreEffect.count({ where: { gameId: game.id, gameTeamId: a } }),
    ).toBe(1);
  });

  it("stays consistent with scores under concurrent changes", async () => {
    const { game, admin, gameTeams } = await createGame({ teams: 3 });
    const ids = gameTeams.map((t) => t.id);

    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        i % 5 === 4
          ? admin.gameAdmin.undoScore().catch(() => undefined)
          : admin.gameAdmin.addScore({ [ids[i % 3]!]: i + 1 }),
      ),
    );

    await expectEvidenceMatchesScores(game.id);
  });
});

describe("games created before PR03", () => {
  beforeAll(async () => {
    await seedLegacyFixture(db);
  });

  it("keeps legacy scores as an opening balance with no invented provenance", async () => {
    expect(await currentScores(LEGACY.teamGame.id)).toMatchObject(
      LEGACY_EXPECTED.teamScores,
    );
    expect(
      await db.scoreEffect.count({ where: { gameId: LEGACY.teamGame.id } }),
    ).toBe(0);
  });

  it("redoes a legacy redo stack in the right order", async () => {
    const host = await db.user.findUniqueOrThrow({
      where: { id: LEGACY.hostUserId },
    });
    const admin = requestCaller({ gameId: LEGACY.teamGame.id, user: host });
    const { teamA, teamB } = LEGACY.teamGame;

    // Legacy history: 0 -> A10 -> A10/B5 -> A30/B5, then two legacy undos.
    await admin.gameAdmin.redoScore();
    expect(await currentScores(LEGACY.teamGame.id)).toMatchObject({
      [teamA]: 10,
      [teamB]: 5,
    });
    await admin.gameAdmin.redoScore();
    expect(await currentScores(LEGACY.teamGame.id)).toMatchObject({
      [teamA]: 30,
      [teamB]: 5,
    });

    await admin.gameAdmin.addScore({ [teamB]: 1 });
    await expectEvidenceMatchesScores(
      LEGACY.teamGame.id,
      LEGACY_EXPECTED.teamScores,
    );
  });
});
