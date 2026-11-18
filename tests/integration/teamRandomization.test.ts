import { randomUUID } from "node:crypto";
import type * as crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleQuizBank } from "@/utils/sequentialQuiz/sample";
import {
  createGame,
  createUser,
  currentScores,
  db,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

const { draw } = vi.hoisted(() => ({
  draw: vi.fn((max: number) => max - 1),
}));
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof crypto>()),
  randomInt: draw,
}));
beforeEach(() => draw.mockReset().mockImplementation((max) => max - 1));

const input = (lockTeams = true) => ({ requestId: randomUUID(), lockTeams });
async function members(gameId: string) {
  return db.gameUser.findMany({
    where: { gameId, removedAt: null },
    orderBy: { index: "asc" },
    select: {
      id: true,
      name: true,
      token: true,
      userId: true,
      gameTeamId: true,
    },
  });
}

describe("random team assignment", () => {
  it("balances every active player, preserves identities/scores, repairs captains and locks switching", async () => {
    const { game, admin, gameTeams } = await createGame({ teams: 3 });
    const players = [];
    for (let i = 0; i < 7; i++) {
      const guest = await joinAsGuest(game.code, `Player ${i}`);
      if (i < 4)
        await guest.player.gameUser.changeTeams({
          gameTeamId: gameTeams[0]!.id,
        });
      players.push(guest);
    }
    const account = await createUser();
    await requestCaller({
      gameId: game.id,
      gameUserToken: players[0]!.token,
      user: account,
    }).gameUser.linkAccount();
    const removed = await joinAsGuest(game.code, "Removed");
    await admin.gameAdmin.roster.removePlayer({
      gameUserId: removed.gameUser.id,
    });
    const removedBefore = await db.gameUser.findUniqueOrThrow({
      where: { id: removed.gameUser.id },
    });
    await admin.gameAdmin.addScore({ [gameTeams[0]!.id]: 15 });
    await admin.gameAdmin.setCaptainsOnly({ captainsOnly: true });
    await admin.gameAdmin.setJoiningOpen({ open: false });
    const before = await members(game.id);
    const scores = await currentScores(game.id);

    await admin.gameAdmin.randomizeTeams(input());

    const after = await members(game.id);
    expect(after.map(({ gameTeamId: _, ...identity }) => identity)).toEqual(
      before.map(({ gameTeamId: _, ...identity }) => identity),
    );
    const teams = await db.gameTeam.findMany({
      where: { gameId: game.id },
      orderBy: { index: "asc" },
      include: { gameUsers: true },
    });
    expect(teams.map((team) => team.gameUsers.length)).toEqual([3, 2, 2]);
    for (const team of teams) {
      expect(
        team.gameUsers.some((player) => player.id === team.captainId),
      ).toBe(true);
    }
    expect(await currentScores(game.id)).toEqual(scores);
    expect(
      await db.gameUser.findUniqueOrThrow({
        where: { id: removed.gameUser.id },
      }),
    ).toEqual(removedBefore);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: game.id } })).settings,
    ).toMatchObject({ freezeTeams: true });
    const first = after[0]!;
    const otherTeam = teams.find((team) => team.id !== first.gameTeamId)!;
    await expect(
      players[0]!.player.gameUser.changeTeams({ gameTeamId: otherTeam.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await admin.gameAdmin.startBuzzer();
    const captain = players.find(
      (player) => player.gameUser.id === teams[0]!.captainId,
    )!;
    await expect(captain.player.gameUser.buzzIn()).resolves.toMatchObject({
      accepted: true,
    });
  });

  it("deduplicates concurrent retries, rejects changed payloads/actors and makes a new confirmed draw", async () => {
    const { game, admin, gameTeams } = await createGame({ teams: 3 });
    for (let i = 0; i < 7; i++) await joinAsGuest(game.code);
    const command = input(false);
    await Promise.all(
      Array.from({ length: 3 }, () => admin.gameAdmin.randomizeTeams(command)),
    );
    const first = await members(game.id);
    expect(
      await db.gameOperation.count({
        where: { gameId: game.id, requestId: command.requestId },
      }),
    ).toBe(1);

    draw.mockImplementation((max) => (max === 7 ? 1 : max - 1));
    await admin.gameAdmin.randomizeTeams(command);
    expect(await members(game.id)).toEqual(first);
    await expect(
      admin.gameAdmin.randomizeTeams({ ...command, lockTeams: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const cohost = await createUser();
    await db.gameAdmin.create({
      data: { gameId: game.id, userId: cohost.id, role: "admin" },
    });
    const cohostApi = requestCaller({ gameId: game.id, user: cohost });
    await expect(
      cohostApi.gameAdmin.randomizeTeams(command),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await cohostApi.gameAdmin.randomizeTeams(input(false));
    const second = await members(game.id);
    expect(second).not.toEqual(first);
    expect(
      gameTeams.map(
        (team) =>
          second.filter((player) => player.gameTeamId === team.id).length,
      ),
    ).toEqual([3, 2, 2]);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: game.id } })).settings,
    ).not.toMatchObject({ freezeTeams: true });
  });

  it("handles fewer players than teams and does not unlock an existing lock when unchecked", async () => {
    const { game, admin } = await createGame({ teams: 3 });
    await joinAsGuest(game.code);
    await joinAsGuest(game.code);
    await admin.gameAdmin.toggleFreezeTeams({ freeze: true });
    await admin.gameAdmin.randomizeTeams(input(false));
    const teams = await db.gameTeam.findMany({
      where: { gameId: game.id },
      include: { gameUsers: true },
    });
    expect(teams.map((team) => team.gameUsers.length).sort()).toEqual([
      0, 1, 1,
    ]);
    for (const team of teams) {
      expect(team.captainId).toBe(team.gameUsers[0]?.id ?? null);
    }
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: game.id } })).settings,
    ).toMatchObject({ freezeTeams: true });
  });

  it("refuses players, moderators and another game's host", async () => {
    const { game, admin } = await createGame();
    const guest = await joinAsGuest(game.code);
    const moderator = await createUser();
    await db.gameAdmin.create({
      data: { gameId: game.id, userId: moderator.id, role: "moderator" },
    });
    const stranger = await createUser();
    for (const [caller, code] of [
      [guest.player, "UNAUTHORIZED"],
      [requestCaller({ gameId: game.id, user: moderator }), "FORBIDDEN"],
      [requestCaller({ gameId: game.id, user: stranger }), "UNAUTHORIZED"],
    ] as const) {
      await expect(
        caller.gameAdmin.randomizeTeams(input()),
      ).rejects.toMatchObject({ code });
    }
    expect(await db.gameOperation.count({ where: { gameId: game.id } })).toBe(
      0,
    );
    await admin.gameAdmin.randomizeTeams(input());
  });

  it.each([
    "noTeams",
    "noPlayers",
    "individual",
    "finished",
    "open",
    "claimed",
    "queue",
    "mode",
  ] as const)(
    "rejects %s without changing membership or locking switching",
    async (condition) => {
      const { game, admin, gameTeams } = await createGame({
        format: condition === "individual" ? "individual" : "team",
        teams: condition === "noTeams" ? 0 : 2,
      });
      const guest =
        condition === "noPlayers" ? null : await joinAsGuest(game.code);
      if (guest && gameTeams[0])
        await guest.player.gameUser.changeTeams({
          gameTeamId: gameTeams[0].id,
        });
      if (condition === "finished") await admin.gameAdmin.finishGame();
      if (condition === "queue")
        await admin.gameAdmin.buzzer.setMode({ mode: "queue" });
      if (["open", "claimed", "queue"].includes(condition)) {
        await admin.gameAdmin.startBuzzer();
        if (condition !== "open") await guest!.player.gameUser.buzzIn();
        if (condition === "queue") await admin.gameAdmin.pauseBuzzer();
      }
      if (condition === "mode") {
        await admin.sequentialQuiz.saveDraft({
          draft: sampleQuizBank(),
          expectedRevision: 0,
        });
        await admin.sequentialQuiz.start();
      }
      const before = await members(game.id);
      await expect(
        admin.gameAdmin.randomizeTeams(input()),
      ).rejects.toMatchObject({
        code:
          condition === "individual" ? "BAD_REQUEST" : "PRECONDITION_FAILED",
      });
      expect(await members(game.id)).toEqual(before);
      expect(
        (await db.game.findUniqueOrThrow({ where: { id: game.id } })).settings,
      ).not.toMatchObject({ freezeTeams: true });
      expect(
        await db.gameOperation.count({
          where: { gameId: game.id, action: "roster.randomizeTeams" },
        }),
      ).toBe(0);
    },
  );
});
