import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  isReady: false,
  incr: vi.fn<(key: string) => Promise<number>>(),
  expire: vi.fn(async () => true),
  ttl: vi.fn(async () => 5),
}));

vi.mock("@/env", () => ({ env: { KV_URL: "redis://unused" } }));
vi.mock("@/logger", () => ({ logger: { warn: vi.fn() } }));
const handlers = vi.hoisted(() => new Map<string, (() => void)[]>());
const listen = (event: string, fn: () => void) => {
  handlers.set(event, [...(handlers.get(event) ?? []), fn]);
  return fake;
};
/** Simulates the client finishing its connection. */
function connected() {
  fake.isReady = true;
  for (const fn of handlers.get("ready") ?? []) fn();
}
vi.mock("redis", () => ({
  createClient: () =>
    Object.assign(fake, {
      on: listen,
      once: listen,
      connect: async () => undefined,
    }),
}));

const { takeChatAllowance, takeRateLimit } = await import("./rateLimit");

const limits = {
  burstMessages: 5,
  burstSeconds: 10,
  perMinute: 30,
  gamePerSecond: 50,
};

describe("server start", () => {
  it("waits for the first connection instead of refusing the first chat message", async () => {
    fake.incr.mockResolvedValue(1);
    const pending = takeChatAllowance({
      gameId: "g",
      actorKey: "player:p",
      limits,
    });
    setTimeout(connected, 50);
    await expect(pending).resolves.toEqual({ allowed: true });
  });
});

describe("rate limits while Redis is unavailable", () => {
  beforeEach(() => {
    fake.isReady = false;
    fake.incr.mockReset();
  });

  it("refuses chat sends rather than letting them through unlimited", async () => {
    await expect(
      takeChatAllowance({ gameId: "g", actorKey: "player:p", limits }),
    ).resolves.toEqual({ allowed: false, reason: "unavailable" });

    fake.isReady = true;
    fake.incr.mockRejectedValue(new Error("connection lost"));
    await expect(
      takeChatAllowance({ gameId: "g", actorKey: "player:p", limits }),
    ).resolves.toEqual({ allowed: false, reason: "unavailable" });
  });

  it("still lets people join, because limits must never stop a game", async () => {
    await expect(takeRateLimit("join", "1.2.3.4")).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    fake.isReady = true;
    fake.incr.mockRejectedValue(new Error("connection lost"));
    await expect(takeRateLimit("join", "1.2.3.4")).resolves.toMatchObject({
      allowed: true,
    });
  });
});

describe("chat allowance", () => {
  beforeEach(() => {
    fake.isReady = true;
    fake.incr.mockReset();
  });

  it("checks the game-wide ceiling before the sender's own limits", async () => {
    fake.incr.mockImplementation(async (key) =>
      key.includes(":game:") ? 51 : 1,
    );
    await expect(
      takeChatAllowance({ gameId: "g", actorKey: "player:p", limits }),
    ).resolves.toEqual({ allowed: false, reason: "gameBusy" });
  });

  it("reports how long to wait after a burst", async () => {
    fake.incr.mockImplementation(async (key) =>
      key.includes(":burst:") ? 6 : 1,
    );
    await expect(
      takeChatAllowance({ gameId: "g", actorKey: "player:p", limits }),
    ).resolves.toEqual({
      allowed: false,
      reason: "tooFast",
      retryAfterSeconds: 5,
    });
  });
});
