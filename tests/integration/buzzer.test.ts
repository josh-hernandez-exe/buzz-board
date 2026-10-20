/**
 * T05: buzzer arbitration. PR01 characterized it; PR04 made the winner a
 * durable claim recorded in the same transaction that closes the window.
 */
import { BuzzerState } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createGame, db, joinAsGuest } from "../support/integration";

async function teamGameWithPlayers(teams: number) {
  const created = await createGame({ teams });
  const players = [];
  for (const team of created.gameTeams) {
    const guest = await joinAsGuest(created.game.code);
    await guest.player.gameUser.changeTeams({ gameTeamId: team.id });
    players.push({ ...guest, teamId: team.id });
  }
  return { ...created, players };
}

async function buzzerStates(gameId: string) {
  const teams = await db.gameTeam.findMany({
    where: { gameId },
    orderBy: { index: "asc" },
  });
  return teams.map((t) => t.buzzerState);
}

describe("buzzer", () => {
  it("rejects a buzz while the buzzer is not listening", async () => {
    const { players } = await teamGameWithPlayers(1);

    await expect(players[0]!.player.gameUser.buzzIn()).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Game is not listening for buzzers",
    });
  });

  it("rejects a player who is not on a team", async () => {
    const { admin, game } = await createGame();
    const guest = await joinAsGuest(game.code);
    await admin.gameAdmin.startBuzzer();

    await expect(guest.player.gameUser.buzzIn()).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("selects the first team and stops listening", async () => {
    const { admin, game, players } = await teamGameWithPlayers(2);
    await admin.gameAdmin.startBuzzer();

    await players[1]!.player.gameUser.buzzIn();

    expect(await buzzerStates(game.id)).toEqual([
      BuzzerState.available,
      BuzzerState.selected,
    ]);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
        .isBuzzerListening,
    ).toBe(false);
  });

  it("chooses exactly one winner when every team buzzes at once", async () => {
    const { admin, game, players } = await teamGameWithPlayers(6);
    await admin.gameAdmin.startBuzzer();

    // Late requests may see `listening: false` (CONFLICT); racing ones lose
    // the guarded update. Either way only one call may succeed.
    const results = await Promise.allSettled(
      players.map((p) => p.player.gameUser.buzzIn()),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const states = await buzzerStates(game.id);
    expect(states.filter((s) => s === BuzzerState.selected)).toHaveLength(1);
    expect(states.filter((s) => s === BuzzerState.available)).toHaveLength(5);
  });

  it("re-opening rejects the selected team and keeps it locked out", async () => {
    const { admin, game, players } = await teamGameWithPlayers(2);
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();

    await admin.gameAdmin.startBuzzer();

    expect(await buzzerStates(game.id)).toEqual([
      BuzzerState.rejected,
      BuzzerState.available,
    ]);
    await expect(players[0]!.player.gameUser.buzzIn()).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Game team has already buzzed in.",
    });
    await players[1]!.player.gameUser.buzzIn();
    expect(await buzzerStates(game.id)).toEqual([
      BuzzerState.rejected,
      BuzzerState.selected,
    ]);
  });

  it("reset makes every team available and stops listening", async () => {
    const { admin, game, players } = await teamGameWithPlayers(2);
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();
    await admin.gameAdmin.startBuzzer();

    await admin.gameAdmin.resetBuzzer();

    expect(await buzzerStates(game.id)).toEqual([
      BuzzerState.available,
      BuzzerState.available,
    ]);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
        .isBuzzerListening,
    ).toBe(false);
  });

  it("works for individual games through each player's backing team", async () => {
    const { admin, game } = await createGame({ format: "individual" });
    const alice = await joinAsGuest(game.code);
    await joinAsGuest(game.code);
    await admin.gameAdmin.startBuzzer();

    await alice.player.gameUser.buzzIn();

    const aliceUser = await db.gameUser.findUniqueOrThrow({
      where: { id: alice.gameUser.id },
      include: { gameTeam: true },
    });
    expect(aliceUser.gameTeam?.buzzerState).toBe(BuzzerState.selected);
  });

  it("records a durable claim for the team the player was on when they buzzed", async () => {
    const { admin, game, players } = await teamGameWithPlayers(2);
    await admin.gameAdmin.startBuzzer();
    const winner = players[0]!;
    await winner.player.gameUser.buzzIn();

    // Moving the winner afterwards does not rewrite which team won.
    await admin.gameAdmin.movePlayerToTeam({
      gameUserId: winner.gameUser.id,
      targetGameTeamId: players[1]!.teamId,
    });

    const claims = await db.buzzClaim.findMany({ where: { gameId: game.id } });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      gameUserId: winner.gameUser.id,
      gameTeamId: winner.teamId,
    });
    const state = await admin.gameGeneral.currentGameState();
    expect(state.buzzWinner).toEqual({
      gameUserId: winner.gameUser.id,
      gameTeamId: winner.teamId,
    });
  });

  it("enforces one claim per window in the database itself", async () => {
    const { admin, game, players } = await teamGameWithPlayers(2);
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();
    const { buzzerWindow } = await db.game.findUniqueOrThrow({
      where: { id: game.id },
    });

    await expect(
      db.buzzClaim.create({
        data: {
          gameId: game.id,
          window: buzzerWindow,
          gameUserId: players[1]!.gameUser.id,
          gameTeamId: players[1]!.teamId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("acknowledges a retried winning buzz after the window has closed", async () => {
    const { admin, game, players } = await teamGameWithPlayers(2);
    await admin.gameAdmin.startBuzzer();
    const requestId = "retry-buzz-0001";

    const first = await players[0]!.player.gameUser.buzzIn({ requestId });
    const retry = await players[0]!.player.gameUser.buzzIn({ requestId });

    expect(first).toEqual({ accepted: true, replayed: false });
    expect(retry).toEqual({ accepted: true, replayed: true });
    await expect(
      players[1]!.player.gameUser.buzzIn({ requestId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.buzzClaim.count({ where: { gameId: game.id } })).toBe(1);
  });

  it("answers a buzz that can't win without waiting for the game lock", async () => {
    const { admin, game, players } = await teamGameWithPlayers(2);
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();

    // Another change holds the game row; losing buzzes are still answered.
    let release!: () => void;
    const held = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Game" WHERE id = ${game.id} FOR UPDATE`;
      await new Promise<void>((resolve) => (release = resolve));
    });
    await new Promise((r) => setTimeout(r, 50));
    const started = Date.now();
    try {
      await expect(players[1]!.player.gameUser.buzzIn()).rejects.toMatchObject({
        message: "Game is not listening for buzzers",
      });
      await expect(players[0]!.player.gameUser.buzzIn()).resolves.toEqual({
        accepted: true,
        replayed: true,
      });
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      release();
      await held;
    }
  });

  it("never has two winners while the host reopens and resets during buzzing", async () => {
    const { admin, game, players } = await teamGameWithPlayers(4);

    for (let round = 0; round < 5; round++) {
      await Promise.allSettled([
        admin.gameAdmin.startBuzzer(),
        ...players.map((p) => p.player.gameUser.buzzIn()),
        round % 2 === 0
          ? admin.gameAdmin.resetBuzzer()
          : admin.gameAdmin.startBuzzer(),
        ...players.map((p) => p.player.gameUser.buzzIn()),
      ]);
      const states = await buzzerStates(game.id);
      expect(
        states.filter((s) => s === BuzzerState.selected).length,
      ).toBeLessThanOrEqual(1);
    }

    const claims = await db.buzzClaim.groupBy({
      by: ["window"],
      where: { gameId: game.id },
      _count: true,
    });
    expect(claims.every((c) => c._count === 1)).toBe(true);
  });

  it("reports a team selected before claims existed without inventing a player", async () => {
    const { admin, game, gameTeams } = await createGame();
    // Shape left by pre-PR04 code: a selected team and no claim.
    await db.gameTeam.update({
      where: { id: gameTeams[0]!.id },
      data: { buzzerState: BuzzerState.selected },
    });

    const state = await admin.gameGeneral.currentGameState();
    expect(state.buzzWinner).toEqual({
      gameUserId: null,
      gameTeamId: gameTeams[0]!.id,
    });
    expect(await db.buzzClaim.count({ where: { gameId: game.id } })).toBe(0);
  });

  it("clears the winner when the buzzer is reopened or reset", async () => {
    const { admin, players } = await teamGameWithPlayers(2);
    await admin.gameAdmin.startBuzzer();
    await players[0]!.player.gameUser.buzzIn();

    await admin.gameAdmin.startBuzzer();
    expect((await admin.gameGeneral.currentGameState()).buzzWinner).toBeNull();

    await players[1]!.player.gameUser.buzzIn();
    await admin.gameAdmin.resetBuzzer();
    expect((await admin.gameGeneral.currentGameState()).buzzWinner).toBeNull();
  });
});
