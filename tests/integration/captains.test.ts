/**
 * Team captains through the real routers: who is captain, keeping a
 * captain when players move or leave, choosing one (staff, or the captain
 * handing it on), and captains-only buzzing and quiz answers.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sampleQuizBank } from "@/utils/sequentialQuiz/sample";

import {
  callerFor,
  createGame,
  createUser,
  db,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

const rid = () => randomUUID().replaceAll("-", "");

async function captains(gameId: string) {
  const teams = await db.gameTeam.findMany({
    where: { gameId },
    orderBy: { index: "asc" },
    select: { captain: { select: { name: true } } },
  });
  return teams.map((t) => t.captain?.name ?? null);
}

/** Two teams, auto-assigned: Ada and Cy on team 1, Bea and Di on team 2. */
async function setup({
  buzzerMode = "first",
}: { buzzerMode?: "first" | "queue" } = {}) {
  const created = await createGame({ teams: 2, teamAssignment: "auto" });
  if (buzzerMode === "queue") {
    await created.admin.gameAdmin.buzzer.setMode({ mode: "queue" });
  }
  const players: Awaited<ReturnType<typeof joinAsGuest>>[] = [];
  for (const name of ["Ada", "Bea", "Cy", "Di"]) {
    players.push(await joinAsGuest(created.game.code, name));
  }
  return { ...created, players };
}

describe("who captains", () => {
  it("is the first to join each team, and follows moves and removals", async () => {
    const { game, admin, gameTeams, players } = await setup();
    expect(await captains(game.id)).toEqual(["Ada", "Bea"]);

    // Ada moves to team 2: Cy takes over team 1; team 2 keeps Bea.
    const [ada, , cy] = players;
    await admin.gameAdmin.movePlayerToTeam({
      gameUserId: ada!.gameUser.id,
      targetGameTeamId: gameTeams[1]!.id,
    });
    expect(await captains(game.id)).toEqual(["Cy", "Bea"]);

    // Cy is removed and team 1 is empty: no captain until someone joins.
    await admin.gameAdmin.roster.removePlayer({ gameUserId: cy!.gameUser.id });
    expect(await captains(game.id)).toEqual([null, "Bea"]);
    await joinAsGuest(game.code, "Eve");
    expect(await captains(game.id)).toEqual(["Eve", "Bea"]);
  });

  it("can be chosen by staff, including moderators, or handed on by the captain", async () => {
    const { game, admin, players } = await setup();
    const [ada, bea, cy] = players;
    await admin.gameAdmin.roster.setCaptain({ gameUserId: cy!.gameUser.id });
    expect(await captains(game.id)).toEqual(["Cy", "Bea"]);

    const mod = await createUser("Mod");
    await db.gameAdmin.create({
      data: { userId: mod.id, gameId: game.id, role: "moderator" },
    });
    await requestCaller({
      gameId: game.id,
      user: mod,
    }).gameAdmin.roster.setCaptain({ gameUserId: ada!.gameUser.id });
    expect(await captains(game.id)).toEqual(["Ada", "Bea"]);

    // Only the current captain hands it on, and only within the team.
    await expect(
      cy!.player.gameUser.handCaptaincy({ gameUserId: cy!.gameUser.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      ada!.player.gameUser.handCaptaincy({ gameUserId: bea!.gameUser.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await ada!.player.gameUser.handCaptaincy({ gameUserId: cy!.gameUser.id });
    expect(await captains(game.id)).toEqual(["Cy", "Bea"]);

    // Players can't use the staff route.
    await expect(
      cy!.player.gameAdmin.roster.setCaptain({ gameUserId: cy!.gameUser.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("is shared in the players' game state", async () => {
    const { game, admin, players } = await setup();
    await admin.gameAdmin.setCaptainsOnly({ captainsOnly: true });
    const state = await players[2]!.player.gameGeneral.currentGameState();
    expect(state.game.captainsOnly).toBe(true);
    const team1 = state.gameTeams.find((t) => t.index === 1)!;
    expect(state.gameUsers[team1.captainId!]?.name).toBe("Ada");
    expect(state.game.id).toBe(game.id);
  });
});

describe("captains-only", () => {
  it("lets only the captain buzz (first buzz wins)", async () => {
    const { game, admin, players } = await setup();
    const [ada, , cy] = players;
    await admin.gameAdmin.setCaptainsOnly({ captainsOnly: true });
    await admin.gameAdmin.startBuzzer();

    await expect(
      cy!.player.gameUser.buzzIn({ requestId: rid() }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("captain, Ada") as unknown,
    });
    // The refused buzz didn't close the buzzer for everyone else.
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
        .isBuzzerListening,
    ).toBe(true);
    await expect(
      ada!.player.gameUser.buzzIn({ requestId: rid() }),
    ).resolves.toMatchObject({ accepted: true });
  });

  it("lets only the captain join the queue", async () => {
    const { game, admin, players } = await setup({ buzzerMode: "queue" });
    const [ada, bea, cy] = players;
    await admin.gameAdmin.setCaptainsOnly({ captainsOnly: true });
    await admin.gameAdmin.startBuzzer();
    await expect(
      cy!.player.gameUser.buzzIn({ requestId: rid() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await bea!.player.gameUser.buzzIn({ requestId: rid() });
    await ada!.player.gameUser.buzzIn({ requestId: rid() });
    const queue = await db.buzzQueueEntry.findMany({
      where: { gameId: game.id },
      orderBy: { position: "asc" },
      select: { gameUserId: true },
    });
    expect(queue.map((e) => e.gameUserId)).toEqual([
      bea!.gameUser.id,
      ada!.gameUser.id,
    ]);
  });

  it("lets everyone buzz again when switched off", async () => {
    const { admin, players } = await setup();
    await admin.gameAdmin.setCaptainsOnly({ captainsOnly: true });
    await admin.gameAdmin.setCaptainsOnly({ captainsOnly: false });
    await admin.gameAdmin.startBuzzer();
    await expect(
      players[2]!.player.gameUser.buzzIn({ requestId: rid() }),
    ).resolves.toMatchObject({ accepted: true });
  });

  it("lets only the captain save quiz answers; teammates see them", async () => {
    const { admin, players } = await setup();
    const [ada, , cy] = players;
    await admin.gameAdmin.setCaptainsOnly({ captainsOnly: true });
    const sq = admin.sequentialQuiz;
    await sq.saveDraft({ draft: sampleQuizBank(), expectedRevision: 0 });
    await sq.start();
    const view = await sq.hostView();
    await sq.act({
      action: { type: "next" },
      expectedStep: view.step,
      requestId: rid(),
    });
    const key = (await cy!.player.sequentialQuiz.myAnswer()).questionKey!;
    expect(await cy!.player.sequentialQuiz.myAnswer()).toMatchObject({
      answeredByCaptain: "Ada",
    });
    await expect(
      cy!.player.sequentialQuiz.submitAnswer({
        questionKey: key,
        text: "Six",
        baseRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await ada!.player.sequentialQuiz.submitAnswer({
      questionKey: key,
      text: "Six",
      baseRevision: 0,
    });
    expect(await cy!.player.sequentialQuiz.myAnswer()).toMatchObject({
      answer: { text: "Six", savedBy: "Ada" },
    });
    expect(
      (await ada!.player.sequentialQuiz.myAnswer()).answeredByCaptain,
    ).toBeNull();
  });

  it("is set at creation, copied by duplicate, and only for team games", async () => {
    const host = await createUser();
    const user = await callerFor({ user: host });
    const game = await user.user.game.create({
      name: "Captains",
      format: "team",
      teamCount: 2,
      captainsOnly: true,
    });
    expect(game.captainsOnly).toBe(true);
    const admin = requestCaller({ gameId: game.id, user: host });
    const copy = await admin.gameAdmin.duplicateGame({ requestId: rid() });
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: copy.gameId } }))
        .captainsOnly,
    ).toBe(true);

    const solo = await user.user.game.create({
      name: "Solo",
      format: "individual",
      captainsOnly: true,
    });
    expect(solo.captainsOnly).toBe(false);
    await expect(
      requestCaller({
        gameId: solo.id,
        user: host,
      }).gameAdmin.setCaptainsOnly({ captainsOnly: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
