/**
 * T07 (PR09): chat storage, privacy, moderation, guards and retention,
 * through the real routers against PostgreSQL and Redis.
 */
import { Prisma } from "@prisma/client";
import { mergeChannelView, sinceFor } from "@/utils/chatChannelMerge";
import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { cleanupChat } from "@/server/chat/chatService";

import {
  createGame,
  createUser,
  db,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

const rid = () => randomUUID().replaceAll("-", "");
const GAME = "game";
const team = (id: string) => `team:${id}`;

async function chatGame({
  format = "team",
  players = 2,
}: { format?: "team" | "individual"; players?: number } = {}) {
  const created = await createGame({ format });
  await created.admin.chat.setEnabled({ enabled: true });
  const guests: Awaited<ReturnType<typeof joinAsGuest>>[] = [];
  for (let i = 0; i < players; i++) {
    const guest = await joinAsGuest(created.game.code, `P${i + 1}`);
    if (format === "team") {
      await guest.player.gameUser.changeTeams({
        gameTeamId: created.gameTeams[i % 2]!.id,
      });
    }
    guests.push(guest);
  }
  const say = (
    who: (typeof guests)[number],
    body: string,
    channelKey = GAME,
    requestId = rid(),
  ) => who.player.chat.send({ channelKey, body, requestId });
  return { ...created, guests, say };
}

async function addHelper(gameId: string, role: "admin" | "moderator") {
  const user = await createUser(`${role} helper`);
  await db.gameAdmin.create({ data: { userId: user.id, gameId, role } });
  return { user, desk: requestCaller({ gameId, user }) };
}

describe("chat basics", () => {
  it("is off by default and on only when a host enables it", async () => {
    const { game, admin } = await createGame();
    const guest = await joinAsGuest(game.code);

    await expect(
      guest.player.chat.send({
        channelKey: GAME,
        body: "hi",
        requestId: rid(),
      }),
    ).rejects.toMatchObject({ message: "Chat is turned off for this game." });
    expect(await guest.player.chat.status({})).toMatchObject({
      enabled: false,
    });

    await admin.chat.setEnabled({ enabled: true });
    await expect(
      guest.player.chat.send({
        channelKey: GAME,
        body: "hi",
        requestId: rid(),
      }),
    ).resolves.toMatchObject({ replayed: false });
  });

  it("stores the message before acknowledging it and shows current names", async () => {
    const { game, guests, say, admin } = await chatGame();
    const sent = await say(guests[0]!, "  Hello  ");

    expect(sent.message).toMatchObject({
      sequence: 1,
      body: "Hello",
      state: "visible",
      isOwn: true,
      author: { kind: "player", name: "P1", teamName: "Team 1" },
    });
    expect(await db.chatMessage.count({ where: { gameId: game.id } })).toBe(1);

    await admin.gameAdmin.roster.renamePlayer({
      gameUserId: guests[0]!.gameUser.id,
      name: "Kind Name",
    });
    const view = await guests[1]!.player.chat.channel({ channelKey: GAME });
    expect(view.messages[0]).toMatchObject({
      author: { name: "Kind Name" },
      isOwn: false,
    });
    // Players never see the internal author key.
    expect(view.messages[0]).not.toHaveProperty("actorKey");
  });

  it("accepts 2,000 UTF-8 bytes and rejects 2,001, counting multibyte text", async () => {
    const { guests, say } = await chatGame();

    await expect(say(guests[0]!, "é".repeat(1_000))).resolves.toBeDefined();
    await expect(
      say(guests[0]!, `${"é".repeat(1_000)}x`),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(say(guests[0]!, "   ")).rejects.toMatchObject({
      message: "Type a message first.",
    });
  });

  it("returns the same message for a retry and refuses a reused ID for new text", async () => {
    const { game, guests, say } = await chatGame();
    const requestId = rid();

    const results = await Promise.all(
      Array.from({ length: 4 }, () => say(guests[0]!, "once", GAME, requestId)),
    );

    expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed).length).toBeLessThanOrEqual(1);
    expect(await db.chatMessage.count({ where: { gameId: game.id } })).toBe(1);
    await expect(
      say(guests[0]!, "different", GAME, requestId),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("gives every message in a channel a unique, gapless sequence", async () => {
    const { game, guests, say, admin } = await chatGame({ players: 2 });
    await Promise.all([
      ...[0, 1, 2, 3].map((i) => say(guests[i % 2]!, `m${i}`)),
      admin.chat.send({
        as: "staff",
        channelKey: GAME,
        body: "staff",
        requestId: rid(),
      }),
    ]);

    const rows = await db.chatMessage.findMany({
      where: { gameId: game.id },
      orderBy: { sequence: "asc" },
    });
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("incremental refetch", () => {
  it("returns only new messages when nothing else changed, and a full view otherwise", async () => {
    const { guests, say, admin } = await chatGame();
    const [p1, p2] = guests;
    await say(p1!, "one");
    await say(p1!, "two");
    const full = await p2!.player.chat.channel({ channelKey: GAME });
    expect(full.appendOnly).toBe(false);
    expect(full.messages.map((m) => m.body)).toEqual(["one", "two"]);

    // A new message: only it comes back.
    await say(p1!, "three");
    const since = sinceFor(full);
    const appended = await p2!.player.chat.channel({ channelKey: GAME, since });
    expect(appended.appendOnly).toBe(true);
    expect(appended.messages.map((m) => m.body)).toEqual(["three"]);
    const merged = mergeChannelView(full, appended, 50);
    expect(merged.messages.map((m) => m.body)).toEqual(["one", "two", "three"]);

    // Asking again with the merged view: nothing new.
    const none = await p2!.player.chat.channel({
      channelKey: GAME,
      since: sinceFor(merged),
    });
    expect(none).toMatchObject({ appendOnly: true, messages: [] });

    // A removal changes a message already held: a full view, without it.
    await admin.chat.moderation.remove({ messageId: full.messages[0]!.id });
    const afterRemove = await p2!.player.chat.channel({
      channelKey: GAME,
      since: sinceFor(merged),
    });
    expect(afterRemove.appendOnly).toBe(false);
    expect(afterRemove.messages[0]!.body).toBeNull();

    // So do a pin and a clear.
    await admin.chat.moderation.pin({
      channelKey: GAME,
      messageId: afterRemove.messages[1]!.id,
    });
    const afterPin = await p2!.player.chat.channel({
      channelKey: GAME,
      since: sinceFor(afterRemove),
    });
    expect(afterPin.appendOnly).toBe(false);
    expect(afterPin.pinned?.body).toBe("two");
    await admin.chat.moderation.clear({ channelKey: GAME });
    const afterClear = await p2!.player.chat.channel({
      channelKey: GAME,
      since: sinceFor(afterPin),
    });
    expect(afterClear).toMatchObject({ appendOnly: false, messages: [] });

    // A view claiming a future revision isn't trusted.
    const forged = await p2!.player.chat.channel({
      channelKey: GAME,
      since: { revision: 9_999, afterSequence: 0 },
    });
    expect(forged.appendOnly).toBe(false);
  });

  it("never extends a view across another team's channel", async () => {
    const { guests, gameTeams } = await chatGame();
    await expect(
      guests[0]!.player.chat.channel({
        channelKey: team(gameTeams[1]!.id),
        since: { revision: 0, afterSequence: 0 },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("overload", () => {
  it("answers 'busy' when the database is overloaded, and saves nothing", async () => {
    const { guests, say, game } = await chatGame();
    const spy = vi
      .spyOn(db, "$transaction")
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          "Transaction API error: Unable to start a transaction in the given time.",
          { code: "P2028", clientVersion: Prisma.prismaVersion.client },
        ),
      );
    try {
      await expect(say(guests[0]!, "hello")).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
        message: "Chat is very busy right now. Try again in a moment.",
      });
    } finally {
      spy.mockRestore();
    }
    expect(await db.chatMessage.count({ where: { gameId: game.id } })).toBe(0);
    // Retrying works once the database has room.
    await expect(say(guests[0]!, "hello")).resolves.toMatchObject({
      replayed: false,
    });
  });
});

describe("who can see what", () => {
  it("keeps team chat to the team and staff", async () => {
    const { gameTeams, guests, say, admin } = await chatGame();
    const [teamOne, teamTwo] = [gameTeams[0]!.id, gameTeams[1]!.id];
    await say(guests[0]!, "team one secret", team(teamOne));

    await expect(
      guests[1]!.player.chat.channel({ channelKey: team(teamOne) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      say(guests[1]!, "sneaky", team(teamOne)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const staffView = await admin.chat.channel({
      as: "staff",
      channelKey: team(teamOne),
    });
    expect(staffView.messages.map((m) => m.body)).toEqual(["team one secret"]);
    expect(staffView.label).toBe("Team: Team 1");

    const status = await guests[1]!.player.chat.status({});
    expect(status.channels.map((c) => c.key)).toEqual([GAME, team(teamTwo)]);
  });

  it("moves team chat access with the player, and new teammates see history", async () => {
    const { gameTeams, guests, say, admin } = await chatGame();
    const teamOne = team(gameTeams[0]!.id);
    await say(guests[0]!, "before the move", teamOne);

    await admin.gameAdmin.movePlayerToTeam({
      gameUserId: guests[0]!.gameUser.id,
      targetGameTeamId: gameTeams[1]!.id,
    });
    await admin.gameAdmin.movePlayerToTeam({
      gameUserId: guests[1]!.gameUser.id,
      targetGameTeamId: gameTeams[0]!.id,
    });

    await expect(
      guests[0]!.player.chat.channel({ channelKey: teamOne }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const newcomer = await guests[1]!.player.chat.channel({
      channelKey: teamOne,
    });
    expect(newcomer.messages.map((m) => m.body)).toEqual(["before the move"]);
  });

  it("has only the game channel in individual games", async () => {
    const { guests, admin } = await chatGame({ format: "individual" });

    expect(
      (await guests[0]!.player.chat.status({})).channels.map((c) => c.key),
    ).toEqual([GAME]);
    expect(
      (await admin.chat.status({ as: "staff" })).channels.map((c) => c.key),
    ).toEqual([GAME]);
    await expect(
      admin.chat.channel({
        as: "staff",
        channelKey: team(guests[0]!.gameUser.gameTeamId!),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("shuts out removed players and people from other games", async () => {
    const { guests, admin, say } = await chatGame();
    const other = await chatGame();
    await say(guests[0]!, "hello");

    await admin.gameAdmin.roster.removePlayer({
      gameUserId: guests[0]!.gameUser.id,
    });
    await expect(
      guests[0]!.player.chat.channel({ channelKey: GAME }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const view = await guests[1]!.player.chat.channel({ channelKey: GAME });
    expect(view.messages[0]!.author.name).toBe("Removed player");

    const outsider = requestCaller({
      gameId: other.game.id,
      gameUserToken: guests[1]!.token,
    });
    await expect(
      outsider.chat.channel({ channelKey: GAME }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("identity", () => {
  it("shows staff as Organizer with a role badge, never their account name", async () => {
    const { game, guests } = await chatGame();
    const { desk } = await addHelper(game.id, "moderator");

    await desk.chat.send({
      as: "staff",
      channelKey: GAME,
      body: "Welcome!",
      requestId: rid(),
    });

    const view = await guests[0]!.player.chat.channel({ channelKey: GAME });
    expect(view.messages[0]!.author).toEqual({
      kind: "staff",
      name: "Organizer",
      roleLabel: "Moderator",
      teamName: null,
    });
    expect(JSON.stringify(view)).not.toContain("moderator helper");
  });

  it("lets a host who is also playing choose which identity speaks", async () => {
    const { game, host } = await createGame();
    const ownerDesk = requestCaller({ gameId: game.id, user: host });
    await ownerDesk.chat.setEnabled({ enabled: true });
    const asPlayer = await joinAsGuest(game.code, "Host As Player");
    const both = requestCaller({
      gameId: game.id,
      gameUserToken: asPlayer.token,
      user: host,
    });

    const playerMessage = await both.chat.send({
      channelKey: GAME,
      body: "from my player",
      requestId: rid(),
    });
    const staffMessage = await both.chat.send({
      as: "staff",
      channelKey: GAME,
      body: "from the desk",
      requestId: rid(),
    });

    expect(playerMessage.message.author.name).toBe("Host As Player");
    expect(staffMessage.message.author).toMatchObject({
      name: "Organizer",
      roleLabel: "Owner",
    });
  });

  it("does not let a player act as staff", async () => {
    const { guests } = await chatGame();

    await expect(
      guests[0]!.player.chat.send({
        as: "staff",
        channelKey: GAME,
        body: "I'm the host",
        requestId: rid(),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      guests[0]!.player.chat.moderation.recent(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("channel modes", () => {
  it("keeps a staff-only channel to organizers", async () => {
    const { guests, say, admin } = await chatGame();
    await admin.chat.moderation.setPolicy({
      channelKey: GAME,
      staffOnly: true,
    });

    await expect(say(guests[0]!, "my guess")).rejects.toMatchObject({
      message: "Only organizers can post here right now.",
    });
    await expect(
      admin.chat.send({
        as: "staff",
        channelKey: GAME,
        body: "Round 2!",
        requestId: rid(),
      }),
    ).resolves.toBeDefined();
    expect((await guests[0]!.player.chat.status({})).channels[0]).toMatchObject(
      { staffOnly: true },
    );
  });

  it("applies slow mode to players but not staff", async () => {
    const { guests, say, admin } = await chatGame();
    await admin.chat.moderation.setPolicy({
      channelKey: GAME,
      slowModeSeconds: 30,
    });

    await say(guests[0]!, "first");
    await expect(say(guests[0]!, "second")).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: expect.stringMatching(
        /^Slow mode is on\. Wait \d+ seconds/,
      ) as unknown,
    });
    await expect(say(guests[1]!, "someone else")).resolves.toBeDefined();
    for (let i = 0; i < 2; i++) {
      await admin.chat.send({
        as: "staff",
        channelKey: GAME,
        body: `s${i}`,
        requestId: rid(),
      });
    }
  });
});

describe("muting", () => {
  it("mutes for 10 minutes by default, without stopping play", async () => {
    const { guests, say, admin } = await chatGame();
    const target = `player:${guests[0]!.gameUser.id}`;

    const { until } = await admin.chat.moderation.mute({ actorKey: target });

    expect(until!.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(until!.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    await expect(say(guests[0]!, "let me talk")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await guests[0]!.player.chat.status({})).toMatchObject({
      muted: { until },
    });
    // Muted players can still buzz.
    await admin.gameAdmin.startBuzzer();
    await expect(guests[0]!.player.gameUser.buzzIn()).resolves.toMatchObject({
      accepted: true,
    });

    await admin.chat.moderation.unmute({ actorKey: target });
    await expect(say(guests[0]!, "thanks")).resolves.toBeDefined();
  });

  it("mutes until unmuted, and an expired mute no longer applies", async () => {
    const { game, guests, say, admin } = await chatGame();
    const target = `player:${guests[0]!.gameUser.id}`;

    await admin.chat.moderation.mute({ actorKey: target, minutes: null });
    await expect(say(guests[0]!, "hi")).rejects.toMatchObject({
      message:
        "You're muted in chat until an organizer unmutes you. You can still play.",
    });
    expect(await admin.chat.moderation.mutes()).toEqual([
      { actorKey: target, name: "P1", until: null },
    ]);

    await db.chatMute.update({
      where: { gameId_actorKey: { gameId: game.id, actorKey: target } },
      data: { until: new Date(Date.now() - 1000) },
    });
    await expect(say(guests[0]!, "back")).resolves.toBeDefined();
    expect(await admin.chat.moderation.mutes()).toEqual([]);
  });

  it("follows the role hierarchy", async () => {
    const { game, host, guests } = await chatGame();
    const moderator = await addHelper(game.id, "moderator");
    const cohost = await addHelper(game.id, "admin");

    await expect(
      moderator.desk.chat.moderation.mute({
        actorKey: `staff:${cohost.user.id}`,
      }),
    ).rejects.toMatchObject({ message: "Your role can't mute that person." });
    await expect(
      cohost.desk.chat.moderation.mute({ actorKey: `staff:${host.id}` }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      cohost.desk.chat.moderation.mute({ actorKey: `staff:${cohost.user.id}` }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      cohost.desk.chat.moderation.mute({
        actorKey: `staff:${moderator.user.id}`,
      }),
    ).resolves.toBeDefined();
    await expect(
      moderator.desk.chat.moderation.mute({
        actorKey: `player:${guests[0]!.gameUser.id}`,
      }),
    ).resolves.toBeDefined();
    await expect(
      cohost.desk.chat.moderation.mute({ actorKey: "player:nobody" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accepts no message from someone after their mute commits", async () => {
    const { guests, say, admin } = await chatGame();
    const target = `player:${guests[0]!.gameUser.id}`;

    const results = await Promise.allSettled([
      say(guests[0]!, "a"),
      say(guests[0]!, "b"),
      admin.chat.moderation.mute({ actorKey: target }),
      say(guests[0]!, "c"),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "FORBIDDEN" });
      }
    }
    await expect(say(guests[0]!, "after")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("finishing", () => {
  it("makes chat read-only for players but lets staff post a closing message", async () => {
    const { guests, say, admin } = await chatGame();
    await say(guests[0]!, "good game");

    await Promise.allSettled([
      say(guests[1]!, "racing"),
      admin.gameAdmin.finishGame(),
    ]);

    await expect(say(guests[0]!, "one more")).rejects.toMatchObject({
      message: "This game has finished, so chat is read-only.",
    });
    await expect(
      admin.chat.send({
        as: "staff",
        channelKey: GAME,
        body: "Thanks all!",
        requestId: rid(),
      }),
    ).resolves.toBeDefined();
    expect(await guests[0]!.player.chat.status({})).toMatchObject({
      readOnly: true,
    });
    const view = await guests[0]!.player.chat.channel({ channelKey: GAME });
    expect(view.messages.at(-1)!.body).toBe("Thanks all!");
  });
});

describe("moderation", () => {
  it("removes a message's text for everyone, unpins it, and never restores it", async () => {
    const { game, guests, say, admin } = await chatGame();
    const requestId = rid();
    const { message } = await say(
      guests[0]!,
      "something rude",
      GAME,
      requestId,
    );
    await admin.chat.moderation.pin({
      channelKey: GAME,
      messageId: message.id,
    });

    await admin.chat.moderation.remove({
      messageId: message.id,
      reason: "offensive",
    });

    const view = await guests[1]!.player.chat.channel({ channelKey: GAME });
    expect(view.messages[0]).toMatchObject({ state: "removed", body: null });
    expect(view.pinned).toBeNull();
    const stored = await db.chatMessage.findUniqueOrThrow({
      where: { id: message.id },
    });
    // No text, and no hash of it either: short messages are guessable.
    expect(stored).toMatchObject({ body: null, bodyHash: "redacted" });
    // A retry of the original send returns the removed message, not the text.
    const retry = await say(guests[0]!, "something rude", GAME, requestId);
    expect(retry).toMatchObject({
      replayed: true,
      message: { body: null, state: "removed" },
    });
    // The reason is in the staff audit log only.
    const log = await db.gameOperation.findFirstOrThrow({
      where: { gameId: game.id, action: "chat.remove" },
    });
    expect(log.result).toMatchObject({ reason: "offensive", channel: GAME });
  });

  it("pins one visible message per channel", async () => {
    const { guests, say, admin } = await chatGame();
    const first = await say(guests[0]!, "Rules: be kind");
    const second = await say(guests[1]!, "Round 1 starts soon");

    await admin.chat.moderation.pin({
      channelKey: GAME,
      messageId: first.message.id,
    });
    await admin.chat.moderation.pin({
      channelKey: GAME,
      messageId: second.message.id,
    });

    const view = await guests[0]!.player.chat.channel({ channelKey: GAME });
    expect(view.pinned?.body).toBe("Round 1 starts soon");
    await admin.chat.moderation.pin({ channelKey: GAME, messageId: null });
    expect(
      (await guests[0]!.player.chat.channel({ channelKey: GAME })).pinned,
    ).toBeNull();
  });

  it("clears visible history in one channel only", async () => {
    const { gameTeams, guests, say, admin } = await chatGame();
    const teamOne = team(gameTeams[0]!.id);
    await say(guests[0]!, "old public");
    await say(guests[0]!, "old team", teamOne);

    await admin.chat.moderation.clear({ channelKey: GAME });
    await say(guests[1]!, "new public");

    const view = await guests[0]!.player.chat.channel({ channelKey: GAME });
    expect(view.messages.map((m) => m.body)).toEqual(["new public"]);
    const teamView = await guests[0]!.player.chat.channel({
      channelKey: teamOne,
    });
    expect(teamView.messages.map((m) => m.body)).toEqual(["old team"]);
    const merged = await admin.chat.moderation.recent();
    expect(merged.map((m) => m.body)).toEqual(["old team", "new public"]);
  });

  it("changes a channel's revision whenever something visible changes", async () => {
    const { guests, say, admin } = await chatGame();
    const revision = async () =>
      (await guests[0]!.player.chat.channel({ channelKey: GAME })).revision;

    const seen = [await revision()];
    const { message } = await say(guests[0]!, "x");
    seen.push(await revision());
    await admin.chat.moderation.pin({
      channelKey: GAME,
      messageId: message.id,
    });
    seen.push(await revision());
    await admin.chat.moderation.remove({ messageId: message.id });
    seen.push(await revision());
    await admin.chat.moderation.setPolicy({
      channelKey: GAME,
      staffOnly: true,
    });
    seen.push(await revision());
    await admin.chat.moderation.clear({ channelKey: GAME });
    seen.push(await revision());

    expect(new Set(seen).size).toBe(seen.length);
  });

  it("is available to moderators, tagged by channel, and bounded", async () => {
    const { game, gameTeams, guests, say } = await chatGame();
    const { desk } = await addHelper(game.id, "moderator");
    await say(guests[0]!, "in public");
    await say(guests[1]!, "in team two", team(gameTeams[1]!.id));

    const merged = await desk.chat.moderation.recent();

    expect(merged.map((m) => [m.body, m.channelLabel])).toEqual([
      ["in public", "Everyone"],
      ["in team two", "Team: Team 2"],
    ]);
    expect(merged[0]!.actorKey).toBe(`player:${guests[0]!.gameUser.id}`);
    await expect(
      desk.chat.moderation.recent({ limit: 201 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("recent window", () => {
  it("loads 50 at first and pages back within the newest 200 only", async () => {
    const { game, guests, admin } = await chatGame();
    // Seed directly: the per-person send limit would take minutes.
    const channel = await db.chatChannel
      .findUniqueOrThrow({
        where: { gameId_key: { gameId: game.id, key: GAME } },
      })
      .catch(async () => {
        await admin.chat.channel({ as: "staff", channelKey: GAME });
        return db.chatChannel.findUniqueOrThrow({
          where: { gameId_key: { gameId: game.id, key: GAME } },
        });
      });
    const actor = `player:${guests[0]!.gameUser.id}`;
    await db.chatMessage.createMany({
      data: Array.from({ length: 230 }, (_, i) => ({
        gameId: game.id,
        channelId: channel.id,
        sequence: i + 1,
        actorKey: actor,
        requestId: `seed-${i}`,
        bodyHash: "x",
        body: `m${i + 1}`,
      })),
    });
    await db.chatChannel.update({
      where: { id: channel.id },
      data: { lastSequence: 230 },
    });

    const first = await guests[1]!.player.chat.channel({ channelKey: GAME });
    expect(first.messages).toHaveLength(50);
    expect(first.messages[0]!.sequence).toBe(181);
    expect(first.windowStartsAfter).toBe(30);
    expect(first.hasOlder).toBe(true);

    const older = await guests[1]!.player.chat.channel({
      channelKey: GAME,
      beforeSequence: 181,
      limit: 200,
    });
    expect(older.messages[0]!.sequence).toBe(31);
    expect(older.messages.at(-1)!.sequence).toBe(180);
    expect(older.hasOlder).toBe(false);
  });
});

describe("rate limits", () => {
  it("slows down a flood from one person but not their buzzer", async () => {
    const { guests, say, admin } = await chatGame();
    const results = await Promise.allSettled(
      Array.from({ length: 7 }, (_, i) => say(guests[0]!, `spam ${i}`)),
    );

    const rejected = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(r.reason).toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
    }
    await expect(say(guests[1]!, "others unaffected")).resolves.toBeDefined();
    await admin.gameAdmin.startBuzzer();
    await expect(guests[0]!.player.gameUser.buzzIn()).resolves.toMatchObject({
      accepted: true,
    });
  });
});

describe("retention", () => {
  it("hides bodies older than 7 days on read, then cleanup removes them", async () => {
    const { game, guests, say } = await chatGame();
    const requestId = rid();
    const { message } = await say(guests[0]!, "old news", GAME, requestId);
    await db.chatMessage.update({
      where: { id: message.id },
      data: { createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });

    const view = await guests[1]!.player.chat.channel({ channelKey: GAME });
    expect(view.messages[0]).toMatchObject({ state: "expired", body: null });

    const summary = await cleanupChat();
    expect(summary.expiredBodies).toBeGreaterThanOrEqual(1);
    const stored = await db.chatMessage.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(stored).toMatchObject({ body: null, bodyHash: "redacted" });
    expect(stored.expiredAt).toBeInstanceOf(Date);

    // The retry key survives cleanup, so an old retry can't recreate it.
    const retry = await say(guests[0]!, "old news", GAME, requestId);
    expect(retry).toMatchObject({ replayed: true, message: { body: null } });
    expect(await db.chatMessage.count({ where: { gameId: game.id } })).toBe(1);
  });

  it("strips moderation reasons after 30 days and drops expired mutes", async () => {
    const { game, guests, say, admin } = await chatGame();
    const { message } = await say(guests[0]!, "x");
    await admin.chat.moderation.remove({
      messageId: message.id,
      reason: "spam",
    });
    await admin.chat.moderation.mute({
      actorKey: `player:${guests[1]!.gameUser.id}`,
      minutes: 1,
    });
    await db.gameOperation.updateMany({
      where: { gameId: game.id, action: "chat.remove" },
      data: { createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });
    await db.chatMute.updateMany({
      where: { gameId: game.id },
      data: { until: new Date(Date.now() - 1000) },
    });

    await cleanupChat();

    const log = await db.gameOperation.findFirstOrThrow({
      where: { gameId: game.id, action: "chat.remove" },
    });
    expect(log.result).not.toHaveProperty("reason");
    expect(log.result).toHaveProperty("target");
    expect(await db.chatMute.count({ where: { gameId: game.id } })).toBe(0);
  });
});
