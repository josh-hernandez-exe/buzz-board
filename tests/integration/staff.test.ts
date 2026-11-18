/**
 * T01/T04 (PR07): fixed staff roles, invitations and revocation, through the
 * real routers and game scoping.
 */
import { describe, expect, it } from "vitest";

import { acceptStaffInvite } from "@/server/staff/staffService";

import {
  createGame,
  createUser,
  currentScores,
  db,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

const tokenOf = (path: string) => path.replace("/invite/", "");
const invitePath: unknown = expect.stringMatching(/^\/invite\//);

async function inviteAndAccept(
  admin: ReturnType<typeof requestCaller>,
  role: "cohost" | "moderator",
  gameId: string,
) {
  const user = await createUser(`${role} helper`);
  const { path } = await admin.gameAdmin.staff.createInvite({ role });
  const result = await requestCaller({ user }).user.invite.accept({
    token: tokenOf(path),
  });
  return {
    user,
    result,
    desk: requestCaller({ gameId, user }),
    token: tokenOf(path),
  };
}

describe("existing games", () => {
  it("keeps every pre-PR07 admin as a co-host", async () => {
    const { game } = await createGame();
    const legacy = await createUser("Legacy admin");
    // A row written before roles existed gets the column default.
    await db.$executeRaw`INSERT INTO "GameAdmin" (id, "userId", "gameId") VALUES (${`legacy-${legacy.id}`}, ${legacy.id}, ${game.id})`;

    const desk = requestCaller({ gameId: game.id, user: legacy });

    await expect(desk.gameAdmin.startBuzzer()).resolves.toBeUndefined();
    const { helpers } = await desk.gameAdmin.staff.list();
    expect(helpers).toContainEqual(
      expect.objectContaining({ userId: legacy.id, role: "cohost" }),
    );
  });
});

describe("invitations", () => {
  it("lets a previewed invitation be accepted exactly once", async () => {
    const { game, admin } = await createGame();
    const { path, expiresAt } = await admin.gameAdmin.staff.createInvite({
      role: "cohost",
    });
    const token = tokenOf(path);
    const helper = await createUser("Helper");

    // Opening the link (or a link preview bot) does not use it.
    for (let i = 0; i < 3; i++) {
      await expect(
        requestCaller({}).user.invite.preview({ token }),
      ).resolves.toMatchObject({
        gameId: game.id,
        role: "cohost",
        status: "valid",
      });
    }
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);

    const accepted = await requestCaller({ user: helper }).user.invite.accept({
      token,
    });
    expect(accepted).toEqual({
      gameId: game.id,
      role: "cohost",
      changed: true,
    });

    // A different account cannot reuse it.
    await expect(
      requestCaller({ user: await createUser() }).user.invite.accept({ token }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "This invitation has already been used. Ask the host for a new link.",
    });
    // The same account retrying sees its status without a second grant.
    await expect(
      requestCaller({ user: helper }).user.invite.accept({ token }),
    ).resolves.toEqual({ gameId: game.id, role: "cohost", changed: false });
  });

  it("lets only one of two concurrent accounts redeem an invitation", async () => {
    const { game, admin } = await createGame();
    const { path } = await admin.gameAdmin.staff.createInvite({
      role: "moderator",
    });
    const [a, b] = await Promise.all([createUser(), createUser()]);

    const results = await Promise.allSettled(
      [a, b].map((user) =>
        requestCaller({ user }).user.invite.accept({ token: tokenOf(path) }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.gameAdmin.count({ where: { gameId: game.id } })).toBe(2);
  });

  it("requires a signed-in account to accept", async () => {
    const { admin } = await createGame();
    const { path } = await admin.gameAdmin.staff.createInvite({
      role: "cohost",
    });

    await expect(
      requestCaller({}).user.invite.accept({ token: tokenOf(path) }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects expired, cancelled and unknown invitations with reasons", async () => {
    const { game, host, admin } = await createGame();
    const user = await createUser();

    const expired = await admin.gameAdmin.staff.createInvite({
      role: "cohost",
    });
    await db.gameInvite.update({
      where: { id: expired.inviteId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      requestCaller({ user }).user.invite.accept({
        token: tokenOf(expired.path),
      }),
    ).rejects.toMatchObject({
      message: "This invitation has expired. Ask the host for a new link.",
    });

    const cancelled = await admin.gameAdmin.staff.createInvite({
      role: "cohost",
    });
    await admin.gameAdmin.staff.revokeInvite({ inviteId: cancelled.inviteId });
    await expect(
      requestCaller({ user }).user.invite.accept({
        token: tokenOf(cancelled.path),
      }),
    ).rejects.toMatchObject({
      message: "This invitation was cancelled. Ask the host for a new link.",
    });

    await expect(
      requestCaller({ user }).user.invite.accept({
        token: "x".repeat(43),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { pendingInvites } = await admin.gameAdmin.staff.list();
    expect(pendingInvites).toEqual([]);
    expect(
      await db.gameAdmin.count({ where: { gameId: game.id, userId: user.id } }),
    ).toBe(0);
    expect(host.id).toBeDefined();
  });

  it("stores only a hash of the token", async () => {
    const { admin } = await createGame();
    const { path, inviteId } = await admin.gameAdmin.staff.createInvite({
      role: "cohost",
    });

    const stored = await db.gameInvite.findUniqueOrThrow({
      where: { id: inviteId },
    });
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(tokenOf(path));
  });

  it("never lowers an existing role", async () => {
    const { game, admin } = await createGame();
    const { user, desk } = await inviteAndAccept(admin, "cohost", game.id);
    const { path } = await admin.gameAdmin.staff.createInvite({
      role: "moderator",
    });

    const result = await requestCaller({ user }).user.invite.accept({
      token: tokenOf(path),
    });

    expect(result).toMatchObject({ role: "cohost", changed: false });
    await expect(desk.gameAdmin.startBuzzer()).resolves.toBeUndefined();
  });

  it("lets a moderator be raised to co-host by a new invitation", async () => {
    const { game, admin } = await createGame();
    const { user } = await inviteAndAccept(admin, "moderator", game.id);
    const { path } = await admin.gameAdmin.staff.createInvite({
      role: "cohost",
    });

    await expect(
      requestCaller({ user }).user.invite.accept({ token: tokenOf(path) }),
    ).resolves.toMatchObject({ role: "cohost", changed: true });
  });

  it("does not let a removed helper's old invitation restore their role", async () => {
    const { game, admin } = await createGame();
    const { user, token } = await inviteAndAccept(admin, "cohost", game.id);
    const { helpers } = await admin.gameAdmin.staff.list();
    await admin.gameAdmin.staff.remove({
      gameAdminId: helpers.find((h) => h.userId === user.id)!.gameAdminId,
    });

    await expect(
      requestCaller({ user }).user.invite.accept({ token }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.gameAdmin.count({ where: { gameId: game.id, userId: user.id } }),
    ).toBe(0);
  });

  it("leaves the owner unchanged and the link unused if the owner opens it", async () => {
    const { game, host, admin } = await createGame();
    const { path } = await admin.gameAdmin.staff.createInvite({
      role: "moderator",
    });

    const result = await acceptStaffInvite({
      token: tokenOf(path),
      userId: host.id,
    });

    expect(result._unsafeUnwrap()).toEqual({
      gameId: game.id,
      role: "owner",
      changed: false,
    });
    await expect(
      requestCaller({}).user.invite.preview({ token: tokenOf(path) }),
    ).resolves.toMatchObject({ status: "valid" });
  });

  it("only grants a role in the invitation's own game", async () => {
    const first = await createGame();
    const second = await createGame();
    const { user } = await inviteAndAccept(
      first.admin,
      "cohost",
      first.game.id,
    );

    await expect(
      requestCaller({ gameId: second.game.id, user }).gameAdmin.startBuzzer(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("roles", () => {
  it("lets a co-host run the game and manage helpers, but not delete it", async () => {
    const { game, admin, gameTeams } = await createGame();
    const { desk } = await inviteAndAccept(admin, "cohost", game.id);

    await desk.gameAdmin.startBuzzer();
    await desk.gameAdmin.addScore({ [gameTeams[0]!.id]: 3 });
    expect((await currentScores(game.id))[gameTeams[0]!.id]).toBe(3);
    await expect(
      desk.gameAdmin.staff.createInvite({ role: "moderator" }),
    ).resolves.toMatchObject({ path: invitePath });
    await desk.gameAdmin.finishGame();
    await expect(
      desk.gameAdmin.deleteGame({ confirmName: game.name }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps moderators away from gameplay and helpers, but lets them move players", async () => {
    const { game, admin, gameTeams } = await createGame();
    const { desk } = await inviteAndAccept(admin, "moderator", game.id);
    const guest = await joinAsGuest(game.code);

    for (const call of [
      () => desk.gameAdmin.startBuzzer(),
      () => desk.gameAdmin.addScore({ [gameTeams[0]!.id]: 1 }),
      () => desk.gameAdmin.undoScore(),
      () => desk.gameAdmin.addTeam(),
      () => desk.gameAdmin.finishGame(),
      () => desk.gameAdmin.setJoiningOpen({ open: false }),
      () => desk.gameAdmin.duplicateGame(),
      () => desk.gameAdmin.staff.createInvite({ role: "moderator" }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Your role (Moderator) can't do that.",
      });
    }

    await desk.gameAdmin.movePlayerToTeam({
      gameUserId: guest.gameUser.id,
      targetGameTeamId: gameTeams[1]!.id,
    });
    const state = await desk.gameGeneral.currentGameState();
    expect(state.gameUsers[guest.gameUser.id]?.gameTeamId).toBe(
      gameTeams[1]!.id,
    );
    await expect(desk.gameAdmin.staff.list()).resolves.toMatchObject({
      myRole: "moderator",
    });
  });

  it("never lets helpers change or remove the owner", async () => {
    const { game, host, admin } = await createGame();
    const { desk } = await inviteAndAccept(admin, "cohost", game.id);
    const ownerRow = await db.gameAdmin.findUniqueOrThrow({
      where: { userId_gameId: { userId: host.id, gameId: game.id } },
    });

    await expect(
      desk.gameAdmin.staff.setRole({
        gameAdminId: ownerRow.id,
        role: "moderator",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "The game's owner can't be changed or removed.",
    });
    await expect(
      desk.gameAdmin.staff.remove({ gameAdminId: ownerRow.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The owner stays the owner even without a staff row.
    await db.gameAdmin.delete({ where: { id: ownerRow.id } });
    const list = await admin.gameAdmin.staff.list();
    expect(list.owner.userId).toBe(host.id);
  });

  it("lists the owner and every helper, without moving the owner into helpers", async () => {
    const { game, host, admin } = await createGame();
    const co = await inviteAndAccept(admin, "cohost", game.id);
    const mod = await inviteAndAccept(admin, "moderator", game.id);

    const list = await mod.desk.gameAdmin.staff.list();

    expect(list.owner.userId).toBe(host.id);
    expect(list.helpers.map((h) => [h.userId, h.role])).toEqual([
      [co.user.id, "cohost"],
      [mod.user.id, "moderator"],
    ]);
  });

  it("does not make a player a helper", async () => {
    const { game } = await createGame();
    const guest = await joinAsGuest(game.code);

    await expect(guest.player.gameAdmin.staff.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("revocation", () => {
  it("removes access on the very next request", async () => {
    const { game, admin } = await createGame();
    const { user, desk } = await inviteAndAccept(admin, "cohost", game.id);
    await desk.gameAdmin.startBuzzer();

    const { helpers } = await admin.gameAdmin.staff.list();
    await admin.gameAdmin.staff.remove({
      gameAdminId: helpers.find((h) => h.userId === user.id)!.gameAdminId,
    });

    await expect(desk.gameAdmin.pauseBuzzer()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(desk.gameGeneral.currentGameState()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("demotion takes effect on the next request", async () => {
    const { game, admin } = await createGame();
    const { user, desk } = await inviteAndAccept(admin, "cohost", game.id);
    const { helpers } = await admin.gameAdmin.staff.list();

    await admin.gameAdmin.staff.setRole({
      gameAdminId: helpers.find((h) => h.userId === user.id)!.gameAdminId,
      role: "moderator",
    });

    await expect(desk.gameAdmin.startBuzzer()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("ends a removed helper's private live stream", async () => {
    const { game, admin } = await createGame();
    const { user } = await inviteAndAccept(admin, "cohost", game.id);
    const controller = new AbortController();
    const stream = await requestCaller({
      gameId: game.id,
      user,
      signal: controller.signal,
    }).gameGeneral.gameState();
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();

    const { helpers } = await admin.gameAdmin.staff.list();
    await admin.gameAdmin.staff.remove({
      gameAdminId: helpers.find((h) => h.userId === user.id)!.gameAdminId,
    });

    // Snapshots already queued may still arrive; the stream must then end
    // with the removal error rather than continue.
    const ended = (async () => {
      for (let i = 0; i < 5; i++) await iterator.next();
      return "still streaming";
    })();
    await expect(ended).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Your role in this game was removed.",
    });
    controller.abort();
  });
});
