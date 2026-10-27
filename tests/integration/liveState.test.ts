/**
 * T08 (PR04): live game-state streams over real Redis notifications.
 */
import { createClient } from "redis";
import { ok } from "neverthrow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GameChangeBus } from "@/server/live/gameChangeBus";
import { GameFeed } from "@/server/live/gameFeed";
import { liveFeeds } from "@/server/utils/events";
import {
  applyRosterUpdate,
  type LiveRoster,
  type PrivateGameStateUpdate,
} from "@/utils/liveRoster";

import {
  createGame,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * This process's app connections only: other test files' connections can
 * still be closing on the shared Redis server, which made a global count
 * flaky.
 */
async function redisConnectionCount() {
  const list = await redis.sendCommand<string>(["CLIENT", "LIST"]);
  const mine = `name=buzz-board:${process.pid}:`;
  return list
    .trim()
    .split("\n")
    .filter((line) => line.includes(mine)).length;
}

async function channelSubscribers(gameId: string) {
  const reply = await redis.sendCommand<[string, number]>([
    "PUBSUB",
    "NUMSUB",
    `buzz-board:game-changed:${gameId}`,
  ]);
  return Number(reply[1]);
}

async function eventually<T>(
  read: () => Promise<T> | T,
  done: (value: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(50);
    value = await read();
  }
  return value;
}

/** Collects every snapshot a stream yields until aborted. */
function collect<T>(stream: AsyncIterable<T>) {
  const values: T[] = [];
  const finished = (async () => {
    for await (const value of stream) values.push(value);
  })();
  return { values, finished };
}

async function publicStream(gameId: string) {
  const controller = new AbortController();
  const stream = await requestCaller({
    signal: controller.signal,
  }).public.gameState({ gameId });
  return { controller, ...collect(stream) };
}

describe("public game-state stream", () => {
  it("yields the current state, then each committed change", async () => {
    const { admin, game, gameTeams } = await createGame();
    const s = await publicStream(game.id);
    await eventually(
      () => s.values.length,
      (n) => n >= 1,
    );
    expect(s.values[0]!.gameTeams.map((t) => t.score)).toEqual([0, 0]);

    await admin.gameAdmin.addScore({ [gameTeams[1]!.id]: 7 });

    const last = await eventually(
      () => s.values.at(-1),
      (v) => v?.gameTeams[1]?.score === 7,
    );
    expect(last?.gameTeams.map((t) => t.score)).toEqual([0, 7]);
    s.controller.abort();
    await s.finished;
  });

  it("is available to anonymous displays, unlike the member state stream", async () => {
    const { game } = await createGame();
    const anonymous = requestCaller({ gameId: game.id });

    await expect(
      anonymous.public.currentGameState({ gameId: game.id }),
    ).resolves.toMatchObject({ game: { id: game.id } });
    await expect(
      anonymous.gameGeneral.currentGameState(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("delivers every subscriber's snapshots in commit order and ends on the latest", async () => {
    const { admin, game, gameTeams } = await createGame();
    const a = gameTeams[0]!.id;
    const streams = await Promise.all(
      Array.from({ length: 5 }, () => publicStream(game.id)),
    );
    await eventually(() => streams.every((s) => s.values.length > 0), Boolean);

    await Promise.all(
      Array.from({ length: 20 }, () => admin.gameAdmin.addScore({ [a]: 1 })),
    );

    for (const s of streams) {
      await eventually(
        () => s.values.at(-1)?.gameTeams[0]?.score,
        (score) => score === 20,
      );
      const seen = s.values.map((v) => v.gameTeams[0]!.score);
      expect(seen).toEqual([...seen].sort((x, y) => x - y));
      expect(seen.at(-1)).toBe(20);
      // Bursts are coalesced: fewer snapshots than changes is expected.
      expect(seen.length).toBeLessThanOrEqual(21);
      s.controller.abort();
      await s.finished;
    }
  });
});

describe("joining viewers", () => {
  it("a new viewer gets the latest snapshot without a reload for everyone", async () => {
    const bus = new GameChangeBus(process.env.KV_URL!);
    let loads = 0;
    const feed = new GameFeed(
      "cached",
      () => bus,
      async () => ok(++loads),
    );
    const gameId = `cached-${Date.now()}`;
    const a = new AbortController();
    const first = collect(feed.subscribe(gameId, a.signal));
    // The first read, then one more once the bus confirms its subscription.
    await eventually(
      () => first.values.length,
      (n) => n === 2,
    );
    expect(loads).toBe(2);

    // Ten more viewers: each gets the latest snapshot; nobody is sent
    // anything new and nothing is read again.
    const more = Array.from({ length: 10 }, () =>
      collect(feed.subscribe(gameId, a.signal)),
    );
    await eventually(() => more.every((m) => m.values.length === 1), Boolean);
    expect(loads).toBe(2);
    expect(more.map((m) => m.values)).toEqual(more.map(() => [2]));
    expect(first.values).toEqual([1, 2]);

    // A change: one read, delivered to all eleven.
    await bus.notify(gameId);
    await eventually(
      () => [first, ...more].every((m) => m.values.at(-1) === 3),
      Boolean,
    );
    expect(loads).toBe(3);
    a.abort();
    await Promise.all([first, ...more].map((m) => m.finished));
    await bus.close();
  });
});

describe("player list on the player stream", () => {
  it("is sent whole once, then only as changes, and always matches the game", async () => {
    const { game, admin } = await createGame({ teams: 2 });
    const ana = await joinAsGuest(game.code, "Ana");
    const controller = new AbortController();
    const stream = collect(
      (await requestCaller({
        gameId: game.id,
        gameUserToken: ana.token,
        signal: controller.signal,
      }).gameGeneral.gameState()) as AsyncIterable<PrivateGameStateUpdate>,
    );
    await eventually(
      () => stream.values.length,
      (n) => n >= 1,
    );
    expect(stream.values[0]!.roster.kind).toBe("full");

    // The buzzer opening doesn't change the roster: it isn't resent.
    let seen = stream.values.length;
    await admin.gameAdmin.startBuzzer();
    await eventually(
      () => stream.values.at(-1)?.game.isBuzzerListening,
      Boolean,
    );
    expect(stream.values.slice(seen).map((u) => u.roster.kind)).not.toContain(
      "full",
    );
    expect(stream.values.at(-1)!.roster.kind).toBe("same");

    // A join changes it: only the new player is sent.
    seen = stream.values.length;
    await admin.gameAdmin.pauseBuzzer();
    await joinAsGuest(game.code, "Ben");
    await eventually(
      () => stream.values.slice(seen).some((u) => u.roster.kind === "delta"),
      Boolean,
    );
    const delta = stream.values
      .slice(seen)
      .find((u) => u.roster.kind === "delta")!.roster;
    expect(Object.values((delta as { upsert: object }).upsert)).toEqual([
      expect.objectContaining({ name: "Ben" }),
    ]);

    // Applied in order, the updates give exactly the current state.
    let live: LiveRoster | null = null;
    for (const update of stream.values) live = applyRosterUpdate(live, update);
    const current = await ana.player.gameGeneral.currentGameState();
    expect(live!.state.gameUsers).toEqual(current.gameUsers);
    expect(
      live!.state.gameTeams.map((t) => [t.id, [...t.gameUsers].sort()]),
    ).toEqual(current.gameTeams.map((t) => [t.id, [...t.gameUsers].sort()]));
    controller.abort();
    await stream.finished;
  });
});

describe("stream lifetime", () => {
  it("uses a fixed number of Redis connections and releases subscriptions on disconnect", async () => {
    const { game } = await createGame();
    // Warm up so this process's shared connections already exist.
    const warm = await publicStream(game.id);
    await eventually(
      () => warm.values.length,
      (n) => n > 0,
    );
    warm.controller.abort();
    await warm.finished;
    const baseline = await redisConnectionCount();
    // The shared publisher and subscriber are named and counted.
    expect(baseline).toBeGreaterThan(0);

    const streams = await Promise.all(
      Array.from({ length: 20 }, () => publicStream(game.id)),
    );
    await eventually(() => streams.every((s) => s.values.length > 0), Boolean);

    expect(await redisConnectionCount()).toBe(baseline);
    expect(liveFeeds.publicGameState.subscriberCount(game.id)).toBe(20);
    expect(
      await eventually(
        () => channelSubscribers(game.id),
        (n) => n === 1,
      ),
    ).toBe(1);

    streams.forEach((s) => s.controller.abort());
    await Promise.all(streams.map((s) => s.finished));

    expect(liveFeeds.publicGameState.subscriberCount(game.id)).toBe(0);
    expect(
      await eventually(
        () => channelSubscribers(game.id),
        (n) => n === 0,
      ),
    ).toBe(0);
    expect(await redisConnectionCount()).toBe(baseline);
  });

  it("ends a waiting stream promptly when the client disconnects", async () => {
    const { game } = await createGame();
    const s = await publicStream(game.id);
    await eventually(
      () => s.values.length,
      (n) => n > 0,
    );

    const started = Date.now();
    s.controller.abort();
    await s.finished;

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("Redis loss", () => {
  it("delivers a process's first change to another process", async () => {
    // Two buses stand in for two server processes sharing Redis.
    const listener = new GameChangeBus(process.env.KV_URL!);
    const publisher = new GameChangeBus(process.env.KV_URL!);
    const gameId = `cross-process-${Date.now()}`;
    let received = 0;
    listener.listen(gameId, () => (received += 1));
    await eventually(
      () => channelSubscribers(gameId),
      (n) => n === 1,
    );

    // The listener reloads once when its subscription is confirmed.
    const before = await eventually(
      () => received,
      (n) => n >= 1,
    );

    // The publisher's connection is still opening when it first notifies.
    await publisher.notify(gameId);

    expect(
      await eventually(
        () => received,
        (n) => n === before + 1,
      ),
    ).toBe(before + 1);
    await Promise.all([listener.close(), publisher.close()]);
  });

  it("keeps receiving another process's changes when the last viewer leaves and one returns at once", async () => {
    const listener = new GameChangeBus(process.env.KV_URL!);
    const publisher = new GameChangeBus(process.env.KV_URL!);
    const gameId = `rejoin-${Date.now()}`;
    const stop = listener.listen(gameId, () => undefined);
    await eventually(
      () => channelSubscribers(gameId),
      (n) => n === 1,
    );
    // The only viewer leaves and another arrives before Redis has
    // confirmed the unsubscribe (a display reloading, say).
    stop();
    let received = 0;
    listener.listen(gameId, () => (received += 1));
    expect(
      await eventually(
        () => channelSubscribers(gameId),
        (n) => n === 1,
      ),
    ).toBe(1);
    const before = received;
    await publisher.notify(gameId);
    expect(
      await eventually(
        () => received,
        (n) => n > before,
      ),
    ).toBeGreaterThan(before);
    await Promise.all([listener.close(), publisher.close()]);
  });

  it("recovers the current buzz winner from PostgreSQL after Redis loses its data", async () => {
    const { admin, game, gameTeams } = await createGame();
    const guest = await joinAsGuest(game.code);
    await guest.player.gameUser.changeTeams({ gameTeamId: gameTeams[1]!.id });
    await admin.gameAdmin.startBuzzer();
    await guest.player.gameUser.buzzIn();

    await redis.sendCommand(["FLUSHALL"]);

    const state = await admin.gameGeneral.currentGameState();
    expect(state.buzzWinner).toEqual({
      gameUserId: guest.gameUser.id,
      gameTeamId: gameTeams[1]!.id,
    });
    const controller = new AbortController();
    const whoStream = await requestCaller({
      gameId: game.id,
      gameUserToken: guest.token,
      signal: controller.signal,
    }).gameGeneral.whoBuzzedIn();
    const first = await whoStream[Symbol.asyncIterator]().next();
    expect(first.value?.gameUser?.id).toBe(guest.gameUser.id);
    controller.abort();
  });

  it("catches a change another process made while this one was still subscribing", async () => {
    const listener = new GameChangeBus(process.env.KV_URL!);
    let version = 0;
    // Simulates another process committing right after this process's first
    // read, before its SUBSCRIBE is confirmed: no notification will arrive.
    const feed = new GameFeed(
      "gap",
      () => listener,
      async () => {
        const read = version;
        version = 1;
        return ok(read);
      },
    );
    const controller = new AbortController();
    const s = collect(feed.subscribe(`gap-${Date.now()}`, controller.signal));

    expect(
      await eventually(
        () => s.values.at(-1),
        (v) => v === 1,
      ),
    ).toBe(1);
    expect(s.values[0]).toBe(0);
    controller.abort();
    await s.finished;
    await listener.close();
  });

  it("resyncs streams after the Redis subscriber connection drops", async () => {
    const { game, gameTeams } = await createGame();
    const s = await publicStream(game.id);
    await eventually(
      () => s.values.length,
      (n) => n > 0,
    );

    await redis.sendCommand(["CLIENT", "KILL", "TYPE", "pubsub"]);
    // A change whose notification was lost (e.g. made by another instance
    // while this one was disconnected).
    await db.gameTeam.update({
      where: { id: gameTeams[0]!.id },
      data: { name: "Renamed while disconnected" },
    });

    const last = await eventually(
      () => s.values.at(-1),
      (v) => v?.gameTeams[0]?.name === "Renamed while disconnected",
      10_000,
    );
    expect(last?.gameTeams[0]?.name).toBe("Renamed while disconnected");
    s.controller.abort();
    await s.finished;
  });

  it("keeps updating streams in this process when Redis is unreachable", async () => {
    const bus = new GameChangeBus("redis://127.0.0.1:1");
    let version = 0;
    const feed = new GameFeed(
      "test",
      () => bus,
      async () => ok(version),
    );
    const controller = new AbortController();
    const s = collect(feed.subscribe("offline-game", controller.signal));
    await eventually(
      () => s.values.length,
      (n) => n > 0,
    );

    version = 1;
    const started = Date.now();
    await bus.notify("offline-game");

    // Bounded by the one-time wait for an initial connection.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(
      await eventually(
        () => s.values.at(-1),
        (v) => v === 1,
      ),
    ).toBe(1);

    // After the first attempt, an unreachable Redis does not delay changes.
    version = 2;
    const again = Date.now();
    await bus.notify("offline-game");
    expect(Date.now() - again).toBeLessThan(300);
    expect(
      await eventually(
        () => s.values.at(-1),
        (v) => v === 2,
      ),
    ).toBe(2);
    controller.abort();
    await s.finished;
    await bus.close();
  });
});
