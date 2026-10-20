/**
 * T08 baseline (PR01): live game-state subscriptions over real Redis pub/sub.
 * See scoreboard.test.ts for the `it.fails` convention.
 */
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGame, requestCaller } from "../support/integration";

const redis = createClient({ url: process.env.KV_URL });

beforeAll(async () => {
  await redis.connect();
});
afterAll(async () => {
  await redis.quit();
});

async function redisConnectionCount() {
  const list = await redis.sendCommand<string>(["CLIENT", "LIST"]);
  return list.trim().split("\n").length;
}

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
}

describe("public game-state subscription", () => {
  it("yields the current state, then each published change", async () => {
    const { admin, game, gameTeams } = await createGame();
    const controller = new AbortController();
    const stream = await requestCaller({
      signal: controller.signal,
    }).public.gameState({ gameId: game.id });
    const iterator = stream[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value?.gameTeams.map((t) => t.score)).toEqual([0, 0]);

    const next = iterator.next();
    // Give the lazily-created subscriber time to SUBSCRIBE before publishing.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await admin.gameAdmin.addScore({ [gameTeams[1]!.id]: 7 });

    const update = await next;
    expect(update.value?.gameTeams.map((t) => t.score)).toEqual([0, 7]);

    controller.abort();
  });

  it("is available to anonymous displays, unlike the member state stream", async () => {
    const { game } = await createGame();
    const anonymous = requestCaller({ gameId: game.id });

    await expect(
      anonymous.public.currentGameState({ gameId: game.id }),
    ).resolves.toMatchObject({ game: { id: game.id } });
    // The public scoreboard page mounts GameSoundEffects, which subscribes to
    // this member-only stream, so anonymous displays get no sound cues.
    await expect(
      anonymous.gameGeneral.currentGameState(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.fails(
    "KNOWN DEFECT: releases its Redis subscriber connection when the client disconnects",
    async () => {
      const { game } = await createGame();
      const before = await redisConnectionCount();

      const controller = new AbortController();
      const stream = await requestCaller({
        signal: controller.signal,
      }).public.gameState({ gameId: game.id });
      const iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
      const pending = iterator.next();

      const during = await waitFor(redisConnectionCount, (n) => n > before);
      expect(during).toBeGreaterThan(before);

      controller.abort();
      await pending;

      // Each subscription duplicates the Redis client and never quits it.
      const after = await waitFor(redisConnectionCount, (n) => n <= before);
      expect(after).toBe(before);
    },
  );
});
