/**
 * T05: manual score changes and history through the legacy request shape
 * (`{ [teamId]: amount }`), which pre-PR03 clients still send. PR03 fixed the
 * concurrency and redo defects this file originally pinned with `it.fails`.
 * Receipts and effect evidence are in scoreEffects.test.ts.
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

  it("rejects fractional, non-finite and oversized amounts without changing scores", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;

    for (const amount of [1.5, 1_000_001, -1_000_001]) {
      await expect(
        admin.gameAdmin.addScore({ [a]: amount }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(admin.gameAdmin.setScore({})).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await currentScores(game.id))[a]).toBe(0);
  });

  it("does not add an undo step when nothing changes", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;

    await admin.gameAdmin.addScore({ [a]: 0 });
    await admin.gameAdmin.setScore({ [a]: 0 });

    const scoreboard = await db.scoreboard.findUniqueOrThrow({
      where: { gameId: game.id },
    });
    expect(scoreboard.pastStateIds).toEqual([]);
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

  it("serializes concurrent score changes without losing updates", async () => {
    const { game, admin, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;

    // Before PR03 this deadlocked (PostgreSQL 40P01) or lost updates.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => admin.gameAdmin.addScore({ [a]: 1 })),
    );

    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect((await currentScores(game.id))[a]).toBe(20);
    const scoreboard = await db.scoreboard.findUniqueOrThrow({
      where: { gameId: game.id },
    });
    expect(scoreboard.pastStateIds).toHaveLength(20);
  });
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

  it("redoes multiple undos in order (0 -> 10 -> 30)", async () => {
    const { game, admin, score } = await scoreSequence();

    await admin.gameAdmin.undoScore();
    await admin.gameAdmin.undoScore();
    expect(await score()).toBe(0);

    // Before PR03 the first redo jumped straight to 30.
    await admin.gameAdmin.redoScore();
    expect(await score()).toBe(10);
    await admin.gameAdmin.redoScore();
    expect(await score()).toBe(30);
    await expect(admin.gameAdmin.redoScore()).rejects.toThrow(
      "No past states to redo",
    );

    const scoreboard = await db.scoreboard.findUniqueOrThrow({
      where: { gameId: game.id },
    });
    expect(scoreboard.pastStateIds).toHaveLength(2);
    expect(scoreboard.futureStateIds).toEqual([]);
  });

  it("interleaves undo and redo without skipping states", async () => {
    const { admin, score } = await scoreSequence();

    await admin.gameAdmin.undoScore();
    await admin.gameAdmin.redoScore();
    await admin.gameAdmin.undoScore();
    await admin.gameAdmin.undoScore();
    await admin.gameAdmin.redoScore();

    expect(await score()).toBe(10);
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
