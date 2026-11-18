/**
 * Queued buzzing and buzzer history (docs/buzzer-queue-and-history.md),
 * through the real routers against PostgreSQL.
 */
import { BuzzerState } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createGame, db, joinAsGuest } from "../support/integration";

async function queueGame(teams = 3) {
  const created = await createGame({ teams });
  await created.admin.gameAdmin.buzzer.setMode({ mode: "queue" });
  const players = [];
  for (const team of created.gameTeams) {
    const guest = await joinAsGuest(created.game.code, `P${team.index}`);
    await guest.player.gameUser.changeTeams({ gameTeamId: team.id });
    players.push({ ...guest, teamId: team.id });
  }
  return { ...created, players };
}

const queueOf = async (gameId: string) => {
  const game = await db.game.findUniqueOrThrow({ where: { id: gameId } });
  return db.buzzQueueEntry.findMany({
    where: { gameId, window: game.buzzerWindow },
    orderBy: { position: "asc" },
  });
};
const states = async (gameId: string) =>
  Object.fromEntries(
    (await db.gameTeam.findMany({ where: { gameId } })).map((t) => [
      t.id,
      t.buzzerState,
    ]),
  );

describe("queue mode", () => {
  it("queues every team in buzz order; the first answers, the buzzer stays open", async () => {
    const { admin, game, players } = await queueGame();
    await admin.gameAdmin.startBuzzer();

    for (const p of [players[1]!, players[0]!, players[2]!]) {
      await expect(p.player.gameUser.buzzIn()).resolves.toEqual({
        accepted: true,
        replayed: false,
      });
    }

    const queue = await queueOf(game.id);
    expect(queue.map((e) => [e.position, e.gameTeamId, e.status])).toEqual([
      [1, players[1]!.teamId, "answering"],
      [2, players[0]!.teamId, "waiting"],
      [3, players[2]!.teamId, "waiting"],
    ]);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
        .isBuzzerListening,
    ).toBe(true);
    const state = await players[0]!.player.gameGeneral.currentGameState();
    expect(state.game.buzzerMode).toBe("queue");
    expect(state.buzzQueue).toHaveLength(3);
    expect(state.buzzWinner?.gameTeamId).toBe(players[1]!.teamId);
  });

  it("gives unique, gapless positions when everyone buzzes at once", async () => {
    const created = await createGame({ teams: 6 });
    await created.admin.gameAdmin.buzzer.setMode({ mode: "queue" });
    const players = [];
    for (const team of created.gameTeams) {
      const guest = await joinAsGuest(created.game.code);
      await guest.player.gameUser.changeTeams({ gameTeamId: team.id });
      players.push(guest);
    }
    await created.admin.gameAdmin.startBuzzer();

    await Promise.all(players.map((p) => p.player.gameUser.buzzIn()));

    const queue = await queueOf(created.game.id);
    expect(queue.map((e) => e.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(queue.filter((e) => e.status === "answering")).toHaveLength(1);
    expect(new Set(queue.map((e) => e.gameTeamId)).size).toBe(6);
  });

  it("keeps one entry per team; a teammate's buzz and a retry change nothing", async () => {
    const { admin, game, players, gameTeams } = await queueGame(2);
    const teammate = await joinAsGuest(game.code, "Mate");
    await teammate.player.gameUser.changeTeams({
      gameTeamId: gameTeams[0]!.id,
    });
    await admin.gameAdmin.startBuzzer();
    const requestId = "queue-retry-001";

    await players[0]!.player.gameUser.buzzIn({ requestId });
    await expect(
      players[0]!.player.gameUser.buzzIn({ requestId }),
    ).resolves.toEqual({ accepted: true, replayed: true });
    await expect(teammate.player.gameUser.buzzIn()).resolves.toEqual({
      accepted: true,
      replayed: true,
    });

    expect(await queueOf(game.id)).toHaveLength(1);
  });

  it("wrong locks the team out and moves on; correct closes the buzzer", async () => {
    const { admin, game, players } = await queueGame();
    await admin.gameAdmin.startBuzzer();
    for (const p of players) await p.player.gameUser.buzzIn();
    const [first, second] = await queueOf(game.id);

    await admin.gameAdmin.buzzer.judge({
      entryId: first!.id,
      verdict: "wrong",
    });

    expect((await queueOf(game.id)).map((e) => e.status)).toEqual([
      "wrong",
      "answering",
      "waiting",
    ]);
    expect(await states(game.id)).toMatchObject({
      [players[0]!.teamId]: BuzzerState.rejected,
      [players[1]!.teamId]: BuzzerState.selected,
    });
    await expect(players[0]!.player.gameUser.buzzIn()).rejects.toMatchObject({
      code: "CONFLICT",
    });

    await admin.gameAdmin.buzzer.judge({
      entryId: second!.id,
      verdict: "correct",
    });
    expect((await queueOf(game.id)).map((e) => e.status)).toEqual([
      "wrong",
      "correct",
      "waiting",
    ]);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
        .isBuzzerListening,
    ).toBe(false);
  });

  it("opening after a correct answer starts a fresh question", async () => {
    const { admin, game, players } = await queueGame();
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();
    await players[1]!.player.gameUser.buzzIn();
    const [first, second] = await queueOf(game.id);
    await admin.gameAdmin.buzzer.judge({
      entryId: first!.id,
      verdict: "wrong",
    });
    await admin.gameAdmin.buzzer.judge({
      entryId: second!.id,
      verdict: "correct",
    });

    await admin.gameAdmin.startBuzzer();

    expect(await queueOf(game.id)).toEqual([]);
    expect(Object.values(await states(game.id))).toEqual([
      "available",
      "available",
      "available",
    ]);
    // The team that was wrong last question can buzz again.
    await players[0]!.player.gameUser.buzzIn();
    expect((await queueOf(game.id)).map((e) => e.status)).toEqual([
      "answering",
    ]);
    const { past } = await admin.gameAdmin.buzzer.history();
    expect(past[0]!.label).toBe("Open buzzer for a new question");
  });

  it("deleting the answering team moves the queue on, and undo doesn't bring it back", async () => {
    const { admin, game, players } = await queueGame();
    await admin.gameAdmin.startBuzzer();
    for (const p of players) await p.player.gameUser.buzzIn();
    await admin.gameAdmin.pauseBuzzer();

    await admin.gameAdmin.removeTeam({ gameTeamId: players[0]!.teamId });

    expect((await queueOf(game.id)).map((e) => e.status)).toEqual([
      "skipped",
      "answering",
      "waiting",
    ]);
    expect(await states(game.id)).toMatchObject({
      [players[1]!.teamId]: "selected",
    });

    // Undo the Close: the deleted team stays out of the line.
    await admin.gameAdmin.buzzer.undo();
    expect((await queueOf(game.id)).map((e) => e.status)).toEqual([
      "skipped",
      "answering",
      "waiting",
    ]);
  });

  it("removing a player in an individual game takes them out of the queue", async () => {
    const created = await createGame({ format: "individual" });
    await created.admin.gameAdmin.buzzer.setMode({ mode: "queue" });
    const ada = await joinAsGuest(created.game.code, "Ada");
    const bo = await joinAsGuest(created.game.code, "Bo");
    await created.admin.gameAdmin.startBuzzer();
    await ada.player.gameUser.buzzIn();
    await bo.player.gameUser.buzzIn();
    // A host action after the buzzes, so its snapshot holds them.
    await created.admin.gameAdmin.pauseBuzzer();
    const [first] = await queueOf(created.game.id);

    await created.admin.gameAdmin.roster.removePlayer({
      gameUserId: first!.gameUserId,
    });

    expect((await queueOf(created.game.id)).map((e) => e.status)).toEqual([
      "skipped",
      "answering",
    ]);

    // Undoing the Close (whose snapshot has them answering) doesn't bring
    // them back.
    await created.admin.gameAdmin.buzzer.undo();
    expect((await queueOf(created.game.id)).map((e) => e.status)).toEqual([
      "skipped",
      "answering",
    ]);
  });

  it("skip moves on with no lockout: the team can buzz again", async () => {
    const { admin, game, players } = await queueGame(2);
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();
    await players[1]!.player.gameUser.buzzIn();
    const [first] = await queueOf(game.id);

    await admin.gameAdmin.buzzer.judge({ entryId: first!.id, verdict: "skip" });
    await players[0]!.player.gameUser.buzzIn();

    expect(
      (await queueOf(game.id)).map((e) => [e.gameTeamId, e.status]),
    ).toEqual([
      [players[0]!.teamId, "skipped"],
      [players[1]!.teamId, "answering"],
      [players[0]!.teamId, "waiting"],
    ]);
  });

  it("refuses verdicts on entries that aren't answering", async () => {
    const { admin, game, players } = await queueGame(2);
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();
    await players[1]!.player.gameUser.buzzIn();
    const [, waiting] = await queueOf(game.id);

    await expect(
      admin.gameAdmin.buzzer.judge({ entryId: waiting!.id, verdict: "wrong" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // A waiting entry can be removed (skip).
    await admin.gameAdmin.buzzer.judge({
      entryId: waiting!.id,
      verdict: "skip",
    });
    expect((await queueOf(game.id))[1]!.status).toBe("skipped");
  });

  it("close keeps the queue to work through; late buzzes join after reopening", async () => {
    const { admin, game, players } = await queueGame();
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();
    await admin.gameAdmin.pauseBuzzer();

    await expect(players[1]!.player.gameUser.buzzIn()).rejects.toMatchObject({
      message: "Game is not listening for buzzers",
    });
    const [first] = await queueOf(game.id);
    await admin.gameAdmin.buzzer.judge({
      entryId: first!.id,
      verdict: "wrong",
    });
    await admin.gameAdmin.startBuzzer();
    await players[1]!.player.gameUser.buzzIn();

    expect((await queueOf(game.id)).map((e) => e.status)).toEqual([
      "wrong",
      "answering",
    ]);
  });

  it("next question clears the queue and every lockout", async () => {
    const { admin, game, players } = await queueGame(2);
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();
    const [first] = await queueOf(game.id);
    await admin.gameAdmin.buzzer.judge({
      entryId: first!.id,
      verdict: "wrong",
    });

    await admin.gameAdmin.resetBuzzer();

    expect(await queueOf(game.id)).toEqual([]);
    expect(Object.values(await states(game.id))).toEqual([
      "available",
      "available",
    ]);
    await admin.gameAdmin.startBuzzer();
    await expect(players[0]!.player.gameUser.buzzIn()).resolves.toMatchObject({
      accepted: true,
    });
  });

  it("switches mode only while the buzzer is closed, starting a new question", async () => {
    const { admin, game } = await createGame({ teams: 2 });
    await admin.gameAdmin.startBuzzer();
    await expect(
      admin.gameAdmin.buzzer.setMode({ mode: "queue" }),
    ).rejects.toMatchObject({
      message: "Close the buzzer before switching how buzzing works.",
    });
    await admin.gameAdmin.pauseBuzzer();
    const before = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    await admin.gameAdmin.buzzer.setMode({ mode: "queue" });
    const after = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(after.buzzerMode).toBe("queue");
    expect(after.buzzerWindow).toBeGreaterThan(before.buzzerWindow);
  });

  it("can be chosen when creating a game, and is copied by duplicate", async () => {
    const { admin, game } = await createGame();
    await admin.gameAdmin.buzzer.setMode({ mode: "queue" });
    const { gameId } = await admin.gameAdmin.duplicateGame({
      requestId: "dup-queue-mode-1",
    });
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: gameId } })).buzzerMode,
    ).toBe("queue");
    expect(game.id).not.toBe(gameId);
  });
});

describe("buzzer history", () => {
  it("undoes an accidental Next question, bringing the first-buzz winner back", async () => {
    const created = await createGame({ teams: 2 });
    const { admin, game, gameTeams } = created;
    const guest = await joinAsGuest(game.code);
    await guest.player.gameUser.changeTeams({ gameTeamId: gameTeams[0]!.id });
    await admin.gameAdmin.startBuzzer();
    await guest.player.gameUser.buzzIn();
    await admin.gameAdmin.resetBuzzer();
    expect(
      (await guest.player.gameGeneral.currentGameState()).buzzWinner,
    ).toBeNull();

    await admin.gameAdmin.buzzer.undo();

    const state = await guest.player.gameGeneral.currentGameState();
    expect(state.buzzWinner).toEqual({
      gameUserId: guest.gameUser.id,
      gameTeamId: gameTeams[0]!.id,
    });
    expect(
      state.gameTeams.find((t) => t.id === gameTeams[0]!.id)?.buzzerState,
    ).toBe("selected");

    await admin.gameAdmin.buzzer.redo();
    expect(
      (await guest.player.gameGeneral.currentGameState()).buzzWinner,
    ).toBeNull();
  });

  it("names actions most recent first, and redo follows undo", async () => {
    const { admin } = await createGame({ teams: 2 });
    await admin.gameAdmin.startBuzzer();
    await admin.gameAdmin.pauseBuzzer();
    await admin.gameAdmin.resetBuzzer();

    expect(
      (await admin.gameAdmin.buzzer.history()).past.map((e) => e.label),
    ).toEqual(["Next question", "Close buzzer", "Open buzzer"]);
    await admin.gameAdmin.buzzer.undo();
    const h = await admin.gameAdmin.buzzer.history();
    expect(h.past.map((e) => e.label)).toEqual(["Close buzzer", "Open buzzer"]);
    expect(h.future.map((e) => e.label)).toEqual(["Next question"]);
    await expect(admin.gameAdmin.buzzer.redo()).resolves.toBeUndefined();
    await expect(admin.gameAdmin.buzzer.redo()).rejects.toMatchObject({
      message: "There's no buzzer action to redo.",
    });
  });

  it("undoing a verdict in queue mode restores it, and keeps buzzes made since", async () => {
    const { admin, game, players } = await queueGame();
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();
    await players[1]!.player.gameUser.buzzIn();
    const [first] = await queueOf(game.id);
    await admin.gameAdmin.buzzer.judge({
      entryId: first!.id,
      verdict: "wrong",
    });
    await players[2]!.player.gameUser.buzzIn(); // a late buzz

    await admin.gameAdmin.buzzer.undo();

    expect(
      (await queueOf(game.id)).map((e) => [e.gameTeamId, e.status]),
    ).toEqual([
      [players[0]!.teamId, "answering"],
      [players[1]!.teamId, "waiting"],
      [players[2]!.teamId, "waiting"],
    ]);
    expect(await states(game.id)).toMatchObject({
      [players[0]!.teamId]: "selected",
      [players[1]!.teamId]: "available",
    });
  });

  it("undoing a verdict when a late buzz took the floor keeps one team answering", async () => {
    const { admin, game, players } = await queueGame();
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();
    const [first] = await queueOf(game.id);
    await admin.gameAdmin.buzzer.judge({
      entryId: first!.id,
      verdict: "wrong",
    });
    // Nobody waiting, so the late buzz answers straight away.
    await players[2]!.player.gameUser.buzzIn();
    expect((await queueOf(game.id)).map((e) => e.status)).toEqual([
      "wrong",
      "answering",
    ]);

    await admin.gameAdmin.buzzer.undo();

    expect(
      (await queueOf(game.id)).map((e) => [e.gameTeamId, e.status]),
    ).toEqual([
      [players[0]!.teamId, "answering"],
      [players[2]!.teamId, "waiting"],
    ]);
    expect(await states(game.id)).toMatchObject({
      [players[0]!.teamId]: "selected",
      [players[2]!.teamId]: "available",
    });
  });

  it("undoing Open keeps the buzzes and still has the first in line answering", async () => {
    const { admin, game, players } = await queueGame();
    await admin.gameAdmin.startBuzzer();
    await players[1]!.player.gameUser.buzzIn();
    await players[0]!.player.gameUser.buzzIn();

    await admin.gameAdmin.buzzer.undo();

    expect(
      (await queueOf(game.id)).map((e) => [e.gameTeamId, e.status]),
    ).toEqual([
      [players[1]!.teamId, "answering"],
      [players[0]!.teamId, "waiting"],
    ]);
    expect(await states(game.id)).toMatchObject({
      [players[1]!.teamId]: "selected",
      [players[0]!.teamId]: "available",
    });
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
        .isBuzzerListening,
    ).toBe(false);
  });

  it("undoing a skip after the team buzzed again keeps one place in line", async () => {
    const { admin, game, players } = await queueGame();
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();
    await players[1]!.player.gameUser.buzzIn();
    const [first] = await queueOf(game.id);
    await admin.gameAdmin.buzzer.judge({ entryId: first!.id, verdict: "skip" });
    await players[0]!.player.gameUser.buzzIn(); // back of the line

    await admin.gameAdmin.buzzer.undo(); // the skip

    const queue = await queueOf(game.id);
    const active = queue.filter(
      (e) => e.status === "waiting" || e.status === "answering",
    );
    expect(active.map((e) => [e.gameTeamId, e.status])).toEqual([
      [players[0]!.teamId, "answering"],
      [players[1]!.teamId, "waiting"],
    ]);
  });

  it("undoing the next question after a correct answer keeps the winner highlighted", async () => {
    const { admin, game, players } = await queueGame();
    await admin.gameAdmin.startBuzzer();
    await players[2]!.player.gameUser.buzzIn();
    const [first] = await queueOf(game.id);
    await admin.gameAdmin.buzzer.judge({
      entryId: first!.id,
      verdict: "correct",
    });
    await admin.gameAdmin.startBuzzer(); // a new question

    await admin.gameAdmin.buzzer.undo();

    expect((await queueOf(game.id)).map((e) => e.status)).toEqual(["correct"]);
    expect(await states(game.id)).toMatchObject({
      [players[2]!.teamId]: "selected",
      [players[0]!.teamId]: "available",
    });
  });

  it("an accepted buzz or a new action clears redo", async () => {
    const { admin, game, gameTeams } = await createGame({ teams: 2 });
    const guest = await joinAsGuest(game.code);
    await guest.player.gameUser.changeTeams({ gameTeamId: gameTeams[0]!.id });
    await admin.gameAdmin.startBuzzer();
    await admin.gameAdmin.pauseBuzzer();
    await admin.gameAdmin.buzzer.undo(); // back to open
    expect((await admin.gameAdmin.buzzer.history()).future).toHaveLength(1);

    await guest.player.gameUser.buzzIn();
    expect((await admin.gameAdmin.buzzer.history()).future).toHaveLength(0);

    await admin.gameAdmin.resetBuzzer();
    await admin.gameAdmin.buzzer.undo();
    await admin.gameAdmin.startBuzzer();
    expect((await admin.gameAdmin.buzzer.history()).future).toHaveLength(0);
  });

  it("never reuses a question number after undo, so an old winner can't reappear", async () => {
    const { admin, game, gameTeams } = await createGame({ teams: 2 });
    const [a, b] = await Promise.all(
      gameTeams.map(async (t) => {
        const g = await joinAsGuest(game.code);
        await g.player.gameUser.changeTeams({ gameTeamId: t.id });
        return g;
      }),
    );
    await admin.gameAdmin.startBuzzer();
    await a!.player.gameUser.buzzIn(); // A wins question N
    await admin.gameAdmin.resetBuzzer();
    await admin.gameAdmin.startBuzzer();
    await b!.player.gameUser.buzzIn(); // B wins question N+2
    await admin.gameAdmin.buzzer.undo(); // undo open
    await admin.gameAdmin.buzzer.undo(); // undo reset: A's question again
    await admin.gameAdmin.resetBuzzer();
    await admin.gameAdmin.startBuzzer();

    // The new question has no winner yet: B's old claim isn't picked up.
    expect(
      (await a!.player.gameGeneral.currentGameState()).buzzWinner,
    ).toBeNull();
    await expect(a!.player.gameUser.buzzIn()).resolves.toEqual({
      accepted: true,
      replayed: false,
    });
  });

  it("is limited to the host's roles and keeps at most 50 actions", async () => {
    const { admin, game } = await createGame({ teams: 2 });
    const guest = await joinAsGuest(game.code);
    await expect(guest.player.gameAdmin.buzzer.undo()).rejects.toBeDefined();

    for (let i = 0; i < 27; i++) {
      await admin.gameAdmin.startBuzzer();
      await admin.gameAdmin.pauseBuzzer();
    }
    const row = await db.buzzerHistory.findUniqueOrThrow({
      where: { gameId: game.id },
    });
    expect((row.past as unknown[]).length).toBe(50);
  });
});
