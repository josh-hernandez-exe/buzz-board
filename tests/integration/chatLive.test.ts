/**
 * T08 (PR10): live chat signals. Streams carry channel revisions and posting
 * state only, follow current membership, coalesce bursts, and work across
 * server instances through Redis.
 */
import { randomUUID } from "node:crypto";

import { ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import { loadChatSummary, type ChatPulse } from "@/server/chat/chatLive";
import { GameChangeBus } from "@/server/live/gameChangeBus";
import { GameFeed } from "@/server/live/gameFeed";
import { chatTopic, createChatFeed, liveFeeds } from "@/server/utils/events";

import {
  createGame,
  createUser,
  db,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

const rid = () => randomUUID().replaceAll("-", "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventually<T>(
  read: () => T,
  done: (value: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(25);
    value = read();
  }
  return value;
}

type Caller = ReturnType<typeof requestCaller>;

/** Opens `chat.live` for a fresh request context and records each pulse. */
async function watch(
  open: (signal: AbortSignal) => Caller,
  as?: "player" | "staff",
) {
  const controller = new AbortController();
  const stream = await open(controller.signal).chat.live({ as });
  const pulses: ChatPulse[] = [];
  let error: unknown;
  const finished = (async () => {
    try {
      for await (const pulse of stream) pulses.push(pulse);
    } catch (e) {
      error = e;
    }
  })();
  await eventually(
    () => pulses.length,
    (n) => n > 0,
  );
  return {
    pulses,
    get error() {
      return error;
    },
    latest: () => pulses.at(-1)!,
    stop: async () => {
      controller.abort();
      await finished;
    },
    finished,
  };
}

const revisionOf = (pulse: ChatPulse, key: string) =>
  pulse.channels.find((c) => c.key === key)?.revision;

async function chatRoom() {
  const created = await createGame({ format: "team" });
  await created.admin.chat.setEnabled({ enabled: true });
  const [teamOne, teamTwo] = created.gameTeams;
  const one = await joinAsGuest(created.game.code, "Ana");
  const two = await joinAsGuest(created.game.code, "Ben");
  await one.player.gameUser.changeTeams({ gameTeamId: teamOne!.id });
  await two.player.gameUser.changeTeams({ gameTeamId: teamTwo!.id });
  const asGuest =
    (guest: typeof one) =>
    (signal: AbortSignal): Caller =>
      requestCaller({
        gameId: created.game.id,
        gameUserToken: guest.token,
        signal,
      });
  const asHost = (signal: AbortSignal): Caller =>
    requestCaller({ gameId: created.game.id, user: created.host, signal });
  return {
    ...created,
    one,
    two,
    teamOne: `team:${teamOne!.id}`,
    teamTwo: `team:${teamTwo!.id}`,
    asGuest,
    asHost,
  };
}

describe("chat live signal", () => {
  it("starts with the viewer's channels and posting state, and never carries text", async () => {
    const room = await chatRoom();
    await room.one.player.chat.send({
      channelKey: "game",
      body: "secret words",
      requestId: rid(),
    });

    const player = await watch(room.asGuest(room.one));
    const host = await watch(room.asHost, "staff");

    expect(player.latest()).toMatchObject({
      enabled: true,
      readOnly: false,
      muted: null,
      channels: [
        { key: "game", revision: 1 },
        { key: room.teamOne, revision: 0 },
      ],
    });
    expect(host.latest().channels.map((c) => c.key)).toEqual([
      "game",
      room.teamOne,
      room.teamTwo,
    ]);
    for (const stream of [player, host]) {
      const json = JSON.stringify(stream.pulses);
      expect(json).not.toContain("secret words");
      expect(json).not.toContain("Ana");
      expect(json.length).toBeLessThan(1_024);
    }
    await Promise.all([player.stop(), host.stop()]);
  });

  it("signals a new message only to viewers of that channel", async () => {
    const room = await chatRoom();
    const one = await watch(room.asGuest(room.one));
    const two = await watch(room.asGuest(room.two));
    const host = await watch(room.asHost, "staff");

    await room.one.player.chat.send({
      channelKey: room.teamOne,
      body: "team plan",
      requestId: rid(),
    });

    await eventually(one.latest, (p) => revisionOf(p, room.teamOne) === 1);
    await eventually(host.latest, (p) => revisionOf(p, room.teamOne) === 1);
    expect(revisionOf(one.latest(), room.teamOne)).toBe(1);
    expect(revisionOf(host.latest(), room.teamOne)).toBe(1);
    // Team two's member gets nothing: their channels didn't change.
    await sleep(300);
    expect(two.pulses).toHaveLength(1);

    await room.two.player.chat.send({
      channelKey: "game",
      body: "hello all",
      requestId: rid(),
    });
    await eventually(two.latest, (p) => revisionOf(p, "game") === 1);
    await eventually(one.latest, (p) => revisionOf(p, "game") === 1);
    expect(revisionOf(two.latest(), "game")).toBe(1);
    expect(revisionOf(one.latest(), "game")).toBe(1);
    await Promise.all([one.stop(), two.stop(), host.stop()]);
  });

  it("signals moderation changes: remove, pin, policy, clear and mute", async () => {
    const room = await chatRoom();
    const { message } = await room.one.player.chat.send({
      channelKey: "game",
      body: "rude",
      requestId: rid(),
    });
    const player = await watch(room.asGuest(room.one));
    const start = revisionOf(player.latest(), "game")!;

    await room.admin.chat.moderation.remove({ messageId: message.id });
    await eventually(player.latest, (p) => revisionOf(p, "game")! > start);
    expect(revisionOf(player.latest(), "game")).toBeGreaterThan(start);

    await room.admin.chat.moderation.mute({
      actorKey: `player:${room.one.gameUser.id}`,
      minutes: null,
    });
    await eventually(player.latest, (p) => p.muted !== null);
    expect(player.latest().muted).toEqual({ until: null });

    await room.admin.chat.moderation.unmute({
      actorKey: `player:${room.one.gameUser.id}`,
    });
    await eventually(player.latest, (p) => p.muted === null);
    expect(player.latest().muted).toBeNull();
    await player.stop();
  });

  it("follows team moves at once, so a moved player stops hearing about the old team", async () => {
    const room = await chatRoom();
    const player = await watch(room.asGuest(room.one));

    await room.admin.gameAdmin.movePlayerToTeam({
      gameUserId: room.one.gameUser.id,
      targetGameTeamId: room.gameTeams[1]!.id,
    });

    await eventually(player.latest, (p) =>
      p.channels.some((c) => c.key === room.teamTwo),
    );
    expect(player.latest().channels.map((c) => c.key)).toEqual([
      "game",
      room.teamTwo,
    ]);
    const pulses = player.pulses.length;
    await room.admin.chat.send({
      as: "staff",
      channelKey: room.teamOne,
      body: "old team only",
      requestId: rid(),
    });
    await sleep(300);
    expect(player.pulses).toHaveLength(pulses);
    await player.stop();
  });

  it("changes the roster revision when a name changes, so headers refresh", async () => {
    const room = await chatRoom();
    const player = await watch(room.asGuest(room.two));
    const before = player.latest().rosterRevision;

    await room.admin.gameAdmin.roster.renamePlayer({
      gameUserId: room.one.gameUser.id,
      name: "Kind Name",
    });

    await eventually(player.latest, (p) => p.rosterRevision !== before);
    expect(player.latest().rosterRevision).not.toBe(before);
    await player.stop();
  });

  it("keeps the roster revision when a player joins, so nobody re-fetches", async () => {
    const room = await chatRoom();
    const player = await watch(room.asGuest(room.two));
    const before = player.latest().rosterRevision;
    await joinAsGuest(room.game.code, "Newcomer");
    await room.one.player.chat.send({
      channelKey: "game",
      body: "hello",
      requestId: rid(),
    });
    // The message arrives (a later pulse), but the headers didn't change.
    const pulses = player.pulses.length;
    await eventually(
      () => player.pulses.length,
      (n) => n > pulses,
    );
    expect(player.latest().rosterRevision).toBe(before);

    await room.admin.gameAdmin.roster.removePlayer({
      gameUserId: room.one.gameUser.id,
    });
    await eventually(player.latest, (p) => p.rosterRevision !== before);
    await player.stop();
  });

  it("goes read-only for players when the game finishes", async () => {
    const room = await chatRoom();
    const player = await watch(room.asGuest(room.one));
    const host = await watch(room.asHost, "staff");

    await room.admin.gameAdmin.finishGame();

    await eventually(player.latest, (p) => p.readOnly);
    expect(player.latest().readOnly).toBe(true);
    await sleep(200);
    expect(host.latest().readOnly).toBe(false);
    await Promise.all([player.stop(), host.stop()]);
  });

  it("ends a removed player's stream", async () => {
    const room = await chatRoom();
    const player = await watch(room.asGuest(room.one));

    await room.admin.gameAdmin.roster.removePlayer({
      gameUserId: room.one.gameUser.id,
    });

    await player.finished;
    expect(player.error).toMatchObject({
      code: "FORBIDDEN",
      message: "You were removed from this game.",
    });
  });

  it("ends a helper's stream when their role is removed", async () => {
    const room = await chatRoom();
    const user = await createUser("Mod");
    const admin = await db.gameAdmin.create({
      data: { userId: user.id, gameId: room.game.id, role: "moderator" },
    });
    const moderator = await watch(
      (signal) => requestCaller({ gameId: room.game.id, user, signal }),
      "staff",
    );
    expect(moderator.latest().channels).toHaveLength(3);

    await room.admin.gameAdmin.staff.remove({ gameAdminId: admin.id });

    await moderator.finished;
    expect(moderator.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Your role in this game was removed.",
    });
  });

  it("releases its subscription when the client disconnects", async () => {
    const room = await chatRoom();
    const player = await watch(room.asGuest(room.one));
    expect(liveFeeds.chat.subscriberCount(room.game.id)).toBe(1);

    await player.stop();

    expect(liveFeeds.chat.subscriberCount(room.game.id)).toBe(0);
  });
});

describe("chat feed costs", () => {
  it("coalesces a burst of changes into a few reads", async () => {
    const bus = new GameChangeBus(process.env.KV_URL!);
    let reads = 0;
    const feed = new GameFeed(
      "counting",
      () => bus,
      async () => ok(++reads),
      { topics: (id) => [chatTopic(id)], coalesceMs: 100 },
    );
    const controller = new AbortController();
    const seen: number[] = [];
    const done = (async () => {
      for await (const v of feed.subscribe("burst", controller.signal)) {
        seen.push(v);
      }
    })();
    await eventually(
      () => seen.length,
      (n) => n > 0,
    );
    const before = reads;

    for (let i = 0; i < 50; i++) void bus.notify(chatTopic("burst"));
    await sleep(500);

    // 50 notifications, at most one read in progress plus one after it.
    expect(reads - before).toBeGreaterThanOrEqual(1);
    expect(reads - before).toBeLessThanOrEqual(2);
    controller.abort();
    await done;
    await bus.close();
  });

  it("re-checks periodically, catching a change whose notification was lost", async () => {
    const bus = new GameChangeBus("redis://127.0.0.1:1");
    let value = 1;
    const feed = new GameFeed(
      "periodic",
      () => bus,
      async () => ok(value),
      {
        refreshEveryMs: 200,
      },
    );
    const controller = new AbortController();
    const seen: number[] = [];
    const done = (async () => {
      for await (const v of feed.subscribe("lost", controller.signal)) {
        seen.push(v);
      }
    })();
    await eventually(
      () => seen.length,
      (n) => n > 0,
    );

    value = 2; // changed without any notification
    await eventually(
      () => seen.at(-1),
      (v) => v === 2,
    );
    expect(seen.at(-1)).toBe(2);
    controller.abort();
    await done;
    await bus.close();
  });

  it("delivers a change made on one server to streams on another", async () => {
    const room = await chatRoom();
    const otherServer = new GameChangeBus(process.env.KV_URL!);
    const feed = createChatFeed(() => otherServer);
    const controller = new AbortController();
    const seen: number[] = [];
    const done = (async () => {
      for await (const summary of feed.subscribe(
        room.game.id,
        controller.signal,
      )) {
        seen.push(summary.revisions.game ?? 0);
      }
    })();
    await eventually(
      () => seen.length,
      (n) => n > 0,
    );
    // Let the other server's subscription to Redis settle.
    await sleep(300);

    await room.one.player.chat.send({
      channelKey: "game",
      body: "across servers",
      requestId: rid(),
    });

    await eventually(
      () => seen.at(-1),
      (v) => v === 1,
      2_000,
    );
    expect(seen.at(-1)).toBe(1);
    controller.abort();
    await done;
    await otherServer.close();
  });

  it("loads one bounded summary per game, whatever the message count", async () => {
    const room = await chatRoom();
    for (let i = 0; i < 5; i++) {
      await room.admin.chat.send({
        as: "staff",
        channelKey: "game",
        body: `m${i}`,
        requestId: rid(),
      });
    }
    const summary = (await loadChatSummary(room.game.id))._unsafeUnwrap();
    expect(summary.revisions).toEqual({ game: 5 });
    expect(JSON.stringify(summary)).not.toContain("m1");
  });
});
