/**
 * PR08 (T02-T04, T06): names and rename locks, guarded moves, removal,
 * explicit account linking, guest recovery and shared-network joins.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RATE_LIMITS } from "@/server/utils/rateLimit";

import {
  createGame,
  createUser,
  currentScores,
  db,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

const redis = createClient({ url: process.env.KV_URL });
beforeAll(async () => {
  await redis.connect();
});
afterAll(async () => {
  await redis.quit();
});

async function addHelper(gameId: string, role: "admin" | "moderator") {
  const user = await createUser(`${role} helper`);
  await db.gameAdmin.create({ data: { userId: user.id, gameId, role } });
  return requestCaller({ gameId, user });
}

async function teamGameWithPlayer() {
  const created = await createGame();
  const guest = await joinAsGuest(created.game.code, "Ada");
  await guest.player.gameUser.changeTeams({
    gameTeamId: created.gameTeams[0]!.id,
  });
  return { ...created, guest };
}

describe("names and rename locks", () => {
  it("lets staff rename a player and lock their renaming in one save", async () => {
    const { game, guest } = await teamGameWithPlayer();
    const moderator = await addHelper(game.id, "moderator");

    await moderator.gameAdmin.roster.renamePlayer({
      gameUserId: guest.gameUser.id,
      name: "Player 7",
      allowSelfRename: false,
    });

    const user = await db.gameUser.findUniqueOrThrow({
      where: { id: guest.gameUser.id },
    });
    expect(user).toMatchObject({
      name: "Player 7",
      allowSelfRename: false,
      nameVersion: 1,
    });
    await expect(
      guest.player.gameUser.changeName({ name: "Evasion" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "Your host has locked name changes for you. Ask them if it needs changing.",
    });

    // The lock persists for the same player after resuming.
    const resumed = await requestCaller({}).public.joinGame({
      gameCode: game.code,
      token: guest.token,
    });
    expect(resumed.gameUser).toMatchObject({
      name: "Player 7",
      allowSelfRename: false,
    });

    await moderator.gameAdmin.roster.renamePlayer({
      gameUserId: guest.gameUser.id,
      allowSelfRename: true,
    });
    await expect(
      guest.player.gameUser.changeName({ name: "Ada again" }),
    ).resolves.toMatchObject({ name: "Ada again" });
  });

  it("refuses a player's stale edit instead of overwriting a moderated name", async () => {
    const { game, guest } = await teamGameWithPlayer();
    const moderator = await addHelper(game.id, "moderator");
    const loaded = await guest.player.gameGeneral.currentGameState();
    const version = loaded.gameUsers[guest.gameUser.id]!.nameVersion;

    await moderator.gameAdmin.roster.renamePlayer({
      gameUserId: guest.gameUser.id,
      name: "Kind Name",
    });

    await expect(
      guest.player.gameUser.changeName({
        name: "Rude name",
        expectedNameVersion: version,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await db.gameUser.findUniqueOrThrow({
          where: { id: guest.gameUser.id },
        })
      ).name,
    ).toBe("Kind Name");
  });

  it("locks a team's name for members but not for staff", async () => {
    const { game, guest, admin, gameTeams } = await teamGameWithPlayer();
    const teamId = gameTeams[0]!.id;

    await guest.player.gameUser.changeTeamName({ name: "Quizzards" });
    await admin.gameAdmin.roster.renameTeam({
      gameTeamId: teamId,
      allowMemberRename: false,
    });

    await expect(
      guest.player.gameUser.changeTeamName({ name: "Rude Team" }),
    ).rejects.toMatchObject({
      message:
        "Your host has locked this team's name. Ask them if it needs changing.",
    });
    await admin.gameAdmin.roster.renameTeam({
      gameTeamId: teamId,
      name: "The Owls",
    });
    const state = await requestCaller({}).public.currentGameState({
      gameId: game.id,
    });
    expect(state.gameTeams[0]!.name).toBe("The Owls");
  });

  it("validates staff renames with the same name rules", async () => {
    const { guest, admin, gameTeams } = await teamGameWithPlayer();

    await expect(
      admin.gameAdmin.roster.renamePlayer({
        gameUserId: guest.gameUser.id,
        name: "x".repeat(41),
      }),
    ).rejects.toMatchObject({
      message: "Nickname can be at most 40 characters.",
    });
    await expect(
      admin.gameAdmin.roster.renameTeam({
        gameTeamId: gameTeams[0]!.id,
        name: "\u202eevil",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("only lets team members rename their own team", async () => {
    const { game, gameTeams } = await teamGameWithPlayer();
    const outsider = await joinAsGuest(game.code, "Bo");
    await outsider.player.gameUser.changeTeams({
      gameTeamId: gameTeams[1]!.id,
    });

    // changeTeamName always targets the caller's own team; staff targets any.
    await outsider.player.gameUser.changeTeamName({ name: "Bo's team" });
    const teams = await db.gameTeam.findMany({
      where: { gameId: game.id },
      orderBy: { index: "asc" },
    });
    expect(teams.map((t) => t.name)).toEqual(["Team 1", "Bo's team"]);
  });

  it("keeps an individual player's scoring unit named after them", async () => {
    const { game, admin } = await createGame({ format: "individual" });
    const guest = await joinAsGuest(game.code, "Solo");

    await admin.gameAdmin.roster.renamePlayer({
      gameUserId: guest.gameUser.id,
      name: "Renamed",
    });

    const team = await db.gameTeam.findUniqueOrThrow({
      where: { id: guest.gameUser.gameTeamId! },
    });
    expect(team.name).toBe("Renamed");
    await expect(
      admin.gameAdmin.roster.renameTeam({ gameTeamId: team.id, name: "X" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lets staff fix a final name after the game has finished", async () => {
    const { guest, admin } = await teamGameWithPlayer();
    await admin.gameAdmin.finishGame();

    await expect(
      guest.player.gameUser.changeName({ name: "Too late" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      admin.gameAdmin.roster.renamePlayer({
        gameUserId: guest.gameUser.id,
        name: "Fixed",
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps renaming and locks away from players and from other games", async () => {
    const { game, guest } = await teamGameWithPlayer();
    const other = await createGame();

    await expect(
      guest.player.gameAdmin.roster.renamePlayer({
        gameUserId: guest.gameUser.id,
        allowSelfRename: true,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      other.admin.gameAdmin.roster.renamePlayer({
        gameUserId: guest.gameUser.id,
        name: "Hijack",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(game.id).toBeDefined();
  });
});

describe("moving players", () => {
  it("waits while the buzzer is open, for players and staff alike", async () => {
    const { guest, admin, gameTeams } = await teamGameWithPlayer();
    await admin.gameAdmin.startBuzzer();

    const blocked = {
      code: "CONFLICT",
      message:
        "Players can't change teams while the buzzer is open. Pause it first, then try again.",
    };
    await expect(
      guest.player.gameUser.changeTeams({ gameTeamId: gameTeams[1]!.id }),
    ).rejects.toMatchObject(blocked);
    await expect(
      admin.gameAdmin.movePlayerToTeam({
        gameUserId: guest.gameUser.id,
        targetGameTeamId: gameTeams[1]!.id,
      }),
    ).rejects.toMatchObject(blocked);

    await admin.gameAdmin.pauseBuzzer();
    await admin.gameAdmin.movePlayerToTeam({
      gameUserId: guest.gameUser.id,
      targetGameTeamId: gameTeams[1]!.id,
    });
    expect(
      (
        await db.gameUser.findUniqueOrThrow({
          where: { id: guest.gameUser.id },
        })
      ).gameTeamId,
    ).toBe(gameTeams[1]!.id);
  });

  it("lets staff unassign a player, and keeps points with the old team", async () => {
    const { game, guest, admin, gameTeams } = await teamGameWithPlayer();
    await admin.gameAdmin.addScore({ [gameTeams[0]!.id]: 5 });

    await admin.gameAdmin.movePlayerToTeam({
      gameUserId: guest.gameUser.id,
      targetGameTeamId: null,
    });

    expect(
      (
        await db.gameUser.findUniqueOrThrow({
          where: { id: guest.gameUser.id },
        })
      ).gameTeamId,
    ).toBeNull();
    expect((await currentScores(game.id))[gameTeams[0]!.id]).toBe(5);
  });

  it("lets a moderator move players while the buzzer is closed", async () => {
    const { game, guest, gameTeams } = await teamGameWithPlayer();
    const moderator = await addHelper(game.id, "moderator");

    await moderator.gameAdmin.movePlayerToTeam({
      gameUserId: guest.gameUser.id,
      targetGameTeamId: gameTeams[1]!.id,
    });

    expect(
      (
        await db.gameUser.findUniqueOrThrow({
          where: { id: guest.gameUser.id },
        })
      ).gameTeamId,
    ).toBe(gameTeams[1]!.id);
  });

  it("has no team moves in individual games", async () => {
    const { game, admin } = await createGame({ format: "individual" });
    const a = await joinAsGuest(game.code, "A");
    const b = await joinAsGuest(game.code, "B");

    await expect(
      admin.gameAdmin.movePlayerToTeam({
        gameUserId: a.gameUser.id,
        targetGameTeamId: b.gameUser.gameTeamId,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("removing players", () => {
  it("removes a player at once, even while the buzzer is open", async () => {
    const { game, guest, admin, gameTeams } = await teamGameWithPlayer();
    const moderator = await addHelper(game.id, "moderator");
    await joinAsGuest(game.code, "Teammate").then((t) =>
      t.player.gameUser.changeTeams({ gameTeamId: gameTeams[0]!.id }),
    );
    await admin.gameAdmin.startBuzzer();

    await moderator.gameAdmin.roster.removePlayer({
      gameUserId: guest.gameUser.id,
    });

    // The credential no longer works anywhere.
    await expect(guest.player.gameUser.buzzIn()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      requestCaller({}).public.joinGame({
        gameCode: game.code,
        token: guest.token,
      }),
    ).resolves.toMatchObject({ resumed: false });
    const state = await admin.gameGeneral.currentGameState();
    expect(state.gameUsers[guest.gameUser.id]).toBeUndefined();
    expect(state.gameTeams[0]!.gameUsers).not.toContain(guest.gameUser.id);
    const display = await requestCaller({}).public.currentGameState({
      gameId: game.id,
    });
    expect(
      display.gameTeams.find((t) => t.id === gameTeams[0]!.id)?.numPlayers,
    ).toBe(1);
  });

  it("keeps a removed player's winning buzz and their team's points", async () => {
    const { game, guest, admin, gameTeams } = await teamGameWithPlayer();
    await admin.gameAdmin.startBuzzer();
    await guest.player.gameUser.buzzIn();
    await admin.gameAdmin.addScore({ [gameTeams[0]!.id]: 10 });

    await admin.gameAdmin.roster.removePlayer({
      gameUserId: guest.gameUser.id,
    });

    const state = await admin.gameGeneral.currentGameState();
    expect(state.buzzWinner).toEqual({
      gameUserId: guest.gameUser.id,
      gameTeamId: gameTeams[0]!.id,
    });
    expect((await currentScores(game.id))[gameTeams[0]!.id]).toBe(10);
  });

  it("ends a removed player's live stream", async () => {
    const { game, guest, admin } = await teamGameWithPlayer();
    const controller = new AbortController();
    const stream = await requestCaller({
      gameId: game.id,
      gameUserToken: guest.token,
      signal: controller.signal,
    }).gameGeneral.gameState();
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();

    await admin.gameAdmin.roster.removePlayer({
      gameUserId: guest.gameUser.id,
    });

    const ended = (async () => {
      for (let i = 0; i < 5; i++) await iterator.next();
      return "still streaming";
    })();
    await expect(ended).rejects.toMatchObject({
      message: "You were removed from this game.",
    });
    controller.abort();
  });

  it("does not balance new players onto teams using removed players", async () => {
    const { game, admin, gameTeams } = await createGame({
      teamAssignment: "auto",
    });
    const first = await joinAsGuest(game.code); // Team 1
    await admin.gameAdmin.roster.removePlayer({
      gameUserId: first.gameUser.id,
    });

    const next = await joinAsGuest(game.code);

    expect(next.gameUser.gameTeamId).toBe(gameTeams[0]!.id);
  });
});

describe("account linking", () => {
  it("saves a guest to an account only when asked, and resumes it elsewhere", async () => {
    const { game, guest } = await teamGameWithPlayer();
    const account = await createUser("Ada's account");
    const signedInPlayer = requestCaller({
      gameId: game.id,
      gameUserToken: guest.token,
      user: account,
    });

    await signedInPlayer.gameUser.linkAccount();

    // Another device: signed in, no credential.
    const otherDevice = requestCaller({ user: account });
    const linked = await otherDevice.public.linkedPlayers({
      gameCode: game.code,
    });
    expect(linked).toEqual([
      expect.objectContaining({
        gameUserId: guest.gameUser.id,
        nickname: "Ada",
        teamName: "Team 1",
      }),
    ]);
    const resumed = await otherDevice.public.resumeLinked({
      gameCode: game.code,
      gameUserId: guest.gameUser.id,
    });
    expect(resumed.gameUser.id).toBe(guest.gameUser.id);
    // The first device keeps working.
    await expect(guest.player.gameUser.ping()).resolves.toBe("pong");
  });

  it("never gives another account's player", async () => {
    const { game, guest } = await teamGameWithPlayer();
    const owner = await createUser();
    await requestCaller({
      gameId: game.id,
      gameUserToken: guest.token,
      user: owner,
    }).gameUser.linkAccount();
    const stranger = requestCaller({ user: await createUser() });

    await expect(
      stranger.public.linkedPlayers({ gameCode: game.code }),
    ).resolves.toEqual([]);
    await expect(
      stranger.public.resumeLinked({
        gameCode: game.code,
        gameUserId: guest.gameUser.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      requestCaller({
        gameId: game.id,
        gameUserToken: guest.token,
        user: await createUser(),
      }).gameUser.linkAccount(),
    ).rejects.toMatchObject({
      message: "This player is already saved to a different account.",
    });
  });

  it("won't give one account two players in the same game", async () => {
    const { game, guest } = await teamGameWithPlayer();
    const second = await joinAsGuest(game.code, "Second");
    const account = await createUser();
    await requestCaller({
      gameId: game.id,
      gameUserToken: guest.token,
      user: account,
    }).gameUser.linkAccount();

    await expect(
      requestCaller({
        gameId: game.id,
        gameUserToken: second.token,
        user: account,
      }).gameUser.linkAccount(),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "Your account already has a player in this game (Ada). Join as that player instead, or keep playing as a guest.",
    });
  });

  it("does not save new players to the signed-in account", async () => {
    const { game } = await createGame();
    const account = await createUser();

    const joined = await requestCaller({ user: account }).public.joinGame({
      gameCode: game.code,
      nickname: "Guest",
    });

    expect(joined.gameUser.userId).toBeNull();
  });
});

describe("guest recovery", () => {
  async function recoveryFor(
    gameUserId: string,
    admin: ReturnType<typeof requestCaller>,
  ) {
    const { path } = await admin.gameAdmin.roster.createRecoveryLink({
      gameUserId,
    });
    return path.replace("/recover/", "");
  }

  it("gives a lost guest a new credential and cuts off the old one", async () => {
    const { game, guest, admin, gameTeams } = await teamGameWithPlayer();
    await admin.gameAdmin.addScore({ [gameTeams[0]!.id]: 4 });
    const token = await recoveryFor(guest.gameUser.id, admin);

    // Creating and previewing doesn't cut off the working device.
    await expect(guest.player.gameUser.ping()).resolves.toBe("pong");
    await expect(
      requestCaller({}).public.recoveryPreview({ token }),
    ).resolves.toMatchObject({ nickname: "Ada", status: "valid" });

    const recovered = await requestCaller({}).public.redeemRecovery({ token });

    expect(recovered.gameUser).toMatchObject({
      id: guest.gameUser.id,
      name: "Ada",
      gameTeamId: gameTeams[0]!.id,
    });
    expect(recovered.token).not.toBe(guest.token);
    await expect(guest.player.gameUser.ping()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const newDevice = requestCaller({
      gameId: game.id,
      gameUserToken: recovered.token,
    });
    await expect(newDevice.gameUser.ping()).resolves.toBe("pong");
    expect((await currentScores(game.id))[gameTeams[0]!.id]).toBe(4);

    // A used link can't issue another credential.
    await expect(
      requestCaller({}).public.redeemRecovery({ token }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps a moderated name and lock through recovery", async () => {
    const { guest, admin } = await teamGameWithPlayer();
    await admin.gameAdmin.roster.renamePlayer({
      gameUserId: guest.gameUser.id,
      name: "Locked Name",
      allowSelfRename: false,
    });
    const token = await recoveryFor(guest.gameUser.id, admin);

    const recovered = await requestCaller({}).public.redeemRecovery({ token });

    expect(recovered.gameUser).toMatchObject({
      name: "Locked Name",
      allowSelfRename: false,
    });
  });

  it("is limited to owners and co-hosts, and to unlinked players still in the game", async () => {
    const { game, guest, admin } = await teamGameWithPlayer();
    const moderator = await addHelper(game.id, "moderator");
    await expect(
      moderator.gameAdmin.roster.createRecoveryLink({
        gameUserId: guest.gameUser.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await requestCaller({
      gameId: game.id,
      gameUserToken: guest.token,
      user: await createUser(),
    }).gameUser.linkAccount();
    await expect(
      admin.gameAdmin.roster.createRecoveryLink({
        gameUserId: guest.gameUser.id,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "This player is saved to an account. They can get back in by signing in to that account.",
    });

    const removed = await joinAsGuest(game.code, "Removed");
    await admin.gameAdmin.roster.removePlayer({
      gameUserId: removed.gameUser.id,
    });
    await expect(
      admin.gameAdmin.roster.createRecoveryLink({
        gameUserId: removed.gameUser.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a link once the player is removed or a newer link exists", async () => {
    const { guest, admin } = await teamGameWithPlayer();
    const first = await recoveryFor(guest.gameUser.id, admin);
    const second = await recoveryFor(guest.gameUser.id, admin);

    await expect(
      requestCaller({}).public.redeemRecovery({ token: first }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await admin.gameAdmin.roster.removePlayer({
      gameUserId: guest.gameUser.id,
    });
    await expect(
      requestCaller({}).public.redeemRecovery({ token: second }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("expires after 15 minutes and stores only a hash", async () => {
    const { guest, admin } = await teamGameWithPlayer();
    const token = await recoveryFor(guest.gameUser.id, admin);
    const invite = await db.gameInvite.findFirstOrThrow({
      where: {
        targetGameUserId: guest.gameUser.id,
        usedAt: null,
        revokedAt: null,
      },
    });
    const lifetime = invite.expiresAt.getTime() - invite.createdAt.getTime();
    expect(Math.abs(lifetime - 15 * 60_000)).toBeLessThan(1_000);
    expect(JSON.stringify(invite)).not.toContain(token);

    await db.gameInvite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      requestCaller({}).public.redeemRecovery({ token }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("is not a staff invitation, and a staff invitation is not a recovery link", async () => {
    const { guest, admin } = await teamGameWithPlayer();
    const recovery = await recoveryFor(guest.gameUser.id, admin);
    const { path } = await admin.gameAdmin.staff.createInvite({
      role: "cohost",
    });

    await expect(
      requestCaller({ user: await createUser() }).user.invite.accept({
        token: recovery,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      requestCaller({}).public.redeemRecovery({
        token: path.replace("/invite/", ""),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("join limits", () => {
  const ip = () =>
    `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;

  it("lets 60 people on one network join at once", async () => {
    const { game } = await createGame({ teams: 6, teamAssignment: "auto" });
    const office = ip();

    const joins = await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) =>
        requestCaller({ ip: office }).public.joinGame({
          gameCode: game.code,
          nickname: `Player ${i}`,
        }),
      ),
    );

    expect(joins.filter((j) => j.status === "rejected")).toEqual([]);
    expect(await db.gameUser.count({ where: { gameId: game.id } })).toBe(60);
  });

  it("slows down someone guessing codes, without affecting other networks", async () => {
    const guesser = ip();
    // Warm the limiter's Redis connection so every attempt is counted.
    await requestCaller({ ip: guesser })
      .public.joinGame({ gameCode: "ZZZZZ0" })
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    await redis.del(`buzz-board:rate:unknownCode:${guesser}`);

    const results = await Promise.allSettled(
      Array.from({ length: RATE_LIMITS.unknownCode.limit + 1 }, () =>
        requestCaller({ ip: guesser }).public.joinGame({ gameCode: "ZZZZZ9" }),
      ),
    );
    const codes = results.map((r) =>
      r.status === "rejected" ? (r.reason as { code: string }).code : "OK",
    );
    expect(codes.filter((c) => c === "NOT_FOUND")).toHaveLength(
      RATE_LIMITS.unknownCode.limit,
    );
    expect(codes.filter((c) => c === "TOO_MANY_REQUESTS")).toHaveLength(1);

    // A different network is unaffected.
    const { game } = await createGame();
    await expect(
      requestCaller({ ip: ip() }).public.joinGame({ gameCode: game.code }),
    ).resolves.toBeDefined();
  });
});
