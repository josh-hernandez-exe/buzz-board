/**
 * T05 characterization (PR01): buzzer arbitration as it behaves today. See
 * scoreboard.test.ts for the `it.fails` convention.
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
});
