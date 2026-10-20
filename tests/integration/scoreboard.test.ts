/**
 * T05 characterization (PR01): manual score changes and history as they behave
 * today. `it.fails` marks a known defect, written with the *correct*
 * expectation; when a later PR fixes it, Vitest reports the unexpected pass and
 * the test must be promoted to a normal `it`.
 */
import { describe, expect, it } from "vitest";

import { createGame, currentScores, db } from "../support/integration";

describe("manual scoring", () => {
  it("starts a new game at zero for every team", async () => {
    const { game, gameTeams } = await createGame({ teams: 3 });

    expect(await currentScores(game.id)).toEqual(
      Object.fromEntries(gameTeams.map((t) => [t.id, 0])),
    );
  });

  it("adds positive, negative and zero deltas", async () => {
    const { game, admin, gameTeams } = await createGame();
    const [a, b] = gameTeams.map((t) => t.id) as [string, string];

    await admin.gameAdmin.addScore({ [a]: 10, [b]: -5 });
    await admin.gameAdmin.addScore({ [a]: 0 });

    expect(await currentScores(game.id)).toEqual({ [a]: 10, [b]: -5 });
  });

  it("sets absolute values, including zero and negatives", async () => {
    const { game, admin, gameTeams } = await createGame();
    const [a, b] = gameTeams.map((t) => t.id) as [string, string];

    await admin.gameAdmin.addScore({ [a]: 25, [b]: 25 });
    await admin.gameAdmin.setScore({ [a]: 0, [b]: -3 });

    expect(await currentScores(game.id)).toEqual({ [a]: 0, [b]: -3 });
  });

  it("rejects a team that is not in this game", async () => {
    const { admin, gameTeams } = await createGame();
    const other = await createGame();
    const foreignTeam = other.gameTeams[0]!.id;

    await expect(
      admin.gameAdmin.addScore({ [gameTeams[0]!.id]: 1, [foreignTeam]: 1 }),
    ).rejects.toThrow("Game teams not found");
    expect(await currentScores(other.game.id)).toMatchObject({
      [foreignTeam]: 0,
    });
  });

  it("records one history state per change", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;

    await admin.gameAdmin.addScore({ [a]: 1 });
    await admin.gameAdmin.addScore({ [a]: 1 });

    const scoreboard = await db.scoreboard.findUniqueOrThrow({
      where: { gameId: game.id },
    });
    expect(scoreboard.pastStateIds).toHaveLength(2);
    expect(scoreboard.futureStateIds).toEqual([]);
  });

  it.fails(
    "KNOWN DEFECT: serializes concurrent score changes without losing updates",
    async () => {
      const { game, admin, gameTeams } = await createGame();
      const a = gameTeams[0]!.id;

      // Today scores are read outside the write transaction, and each
      // transaction inserts a ScoreboardState (FK key-share lock on the
      // scoreboard row) before updating that row. Parallel changes deadlock
      // (PostgreSQL 40P01) or time out, and survivors can overwrite each other.
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => admin.gameAdmin.addScore({ [a]: 1 })),
      );

      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
      expect((await currentScores(game.id))[a]).toBe(20);
    },
  );
});

describe("undo / redo history", () => {
  async function scoreSequence() {
    const created = await createGame();
    const a = created.gameTeams[0]!.id;
    const score = async () => (await currentScores(created.game.id))[a];

    // 0 -> 10 -> 30
    await created.admin.gameAdmin.addScore({ [a]: 10 });
    await created.admin.gameAdmin.addScore({ [a]: 20 });
    return { ...created, a, score };
  }

  it("undoes back to the opening state", async () => {
    const { admin, score } = await scoreSequence();

    await admin.gameAdmin.undoScore();
    expect(await score()).toBe(10);
    await admin.gameAdmin.undoScore();
    expect(await score()).toBe(0);
    await expect(admin.gameAdmin.undoScore()).rejects.toThrow(
      "No past states to undo",
    );
  });

  it("redoes a single undo", async () => {
    const { admin, score } = await scoreSequence();

    await admin.gameAdmin.undoScore();
    await admin.gameAdmin.redoScore();
    expect(await score()).toBe(30);
  });

  it.fails(
    "KNOWN DEFECT: redoes multiple undos in order (0 -> 10 -> 30)",
    async () => {
      const { admin, score } = await scoreSequence();

      await admin.gameAdmin.undoScore();
      await admin.gameAdmin.undoScore();
      expect(await score()).toBe(0);

      // undo prepends to futureStateIds, but redo reads the *last* entry and
      // drops the *first*, so the first redo jumps straight to 30.
      await admin.gameAdmin.redoScore();
      expect(await score()).toBe(10);
      await admin.gameAdmin.redoScore();
      expect(await score()).toBe(30);
    },
  );

  it("documents today's redo order: two undos then redo jumps to the newest state", async () => {
    const { game, admin, score } = await scoreSequence();

    await admin.gameAdmin.undoScore();
    await admin.gameAdmin.undoScore();
    await admin.gameAdmin.redoScore();

    expect(await score()).toBe(30);
    const scoreboard = await db.scoreboard.findUniqueOrThrow({
      where: { gameId: game.id },
    });
    // The remaining redo entry is the state that is already current.
    expect(scoreboard.futureStateIds).toEqual([scoreboard.currentStateId]);
  });

  it("discards the redo branch when a new change is made", async () => {
    const { admin, a, score } = await scoreSequence();

    await admin.gameAdmin.undoScore();
    await admin.gameAdmin.addScore({ [a]: 1 });

    expect(await score()).toBe(11);
    await expect(admin.gameAdmin.redoScore()).rejects.toThrow(
      "No past states to redo",
    );
  });
});
