/**
 * PR02 topology spike: two production (`next start`) instances sharing one
 * Redis and PostgreSQL. Measures cross-instance delivery, SSE response headers
 * and Redis connections per subscriber, then writes a JSON report.
 *
 *   bun run test:services:up
 *   SKIP_ENV_VALIDATION=1 KV_URL=redis://localhost:56379/0 bun run build
 *   bun tests/spike/twoInstance.ts [subscribersPerInstance=25]
 *
 * Uses only the disposable test services; never point it at a real deployment.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";

import {
  assertDisposableDatabase,
  testDatabaseUrl,
  testKvUrl,
} from "../support/testEnv";

const PER_INSTANCE = Number(process.argv[2] ?? 25);
const PORTS = [3201, 3202] as const;
const databaseUrl = testDatabaseUrl();
assertDisposableDatabase(databaseUrl);

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const redis = createClient({ url: testKvUrl() });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startInstance(port: number): ChildProcess {
  return spawn("bunx", ["next", "start", "--port", String(port)], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      KV_URL: testKvUrl(),
      AUTH_SECRET: "spike-only-secret",
      AUTH_TRUST_HOST: "true",
      NEXTAUTH_URL: `http://localhost:${port}`,
      AUTH_DISCORD_CLIENT_ID: "unused",
      AUTH_DISCORD_CLIENT_SECRET: "unused",
      AUTH_GOOGLE_CLIENT_ID: "unused",
      AUTH_GOOGLE_CLIENT_SECRET: "unused",
      NEXT_PUBLIC_QRCODE_BASE_URL: `http://localhost:${port}`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "ignore",
  });
}

async function waitForHttp(port: number) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/join`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`instance on ${port} did not start`);
}

async function redisClients() {
  const list = await redis.sendCommand<string>(["CLIENT", "LIST"]);
  return list.trim().split("\n").length;
}

async function seedGame() {
  const sessionToken = randomBytes(32).toString("hex");
  const host = await db.user.create({
    data: {
      name: "Spike Host",
      email: `${randomUUID()}@example.test`,
      sessions: {
        create: { sessionToken, expires: new Date(Date.now() + 3_600_000) },
      },
    },
  });
  const game = await db.game.create({
    data: {
      name: `Spike ${Date.now()}`,
      code: randomBytes(3).toString("hex").toUpperCase(),
      format: "team",
      createdById: host.id,
      gameAdmins: { create: { userId: host.id } },
      scoreboard: { create: {} },
      gameTeams: { create: [{ index: 1, name: "Team 1" }] },
    },
    include: { scoreboard: true, gameTeams: true },
  });
  const state = await db.scoreboardState.create({
    data: { gameId: game.id, scoreboardId: game.scoreboard!.id },
  });
  await db.scoreboard.update({
    where: { id: game.scoreboard!.id },
    data: { currentStateId: state.id },
  });
  return { game, teamId: game.gameTeams[0]!.id, sessionToken };
}

type Subscriber = {
  port: number;
  controller: AbortController;
  headers?: Record<string, string>;
  scores: { score: number; at: number }[];
  ready: Promise<void>;
};

function subscribe(port: number, gameId: string): Subscriber {
  const controller = new AbortController();
  const sub: Subscriber = {
    port,
    controller,
    scores: [],
    ready: Promise.resolve(),
  };
  const input = encodeURIComponent(JSON.stringify({ json: { gameId } }));
  sub.ready = (async () => {
    const res = await fetch(
      `http://localhost:${port}/api/trpc/public.gameState?input=${input}`,
      { headers: { accept: "text/event-stream" }, signal: controller.signal },
    );
    sub.headers = Object.fromEntries(res.headers.entries());
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            for (const line of event.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const parsed = JSON.parse(line.slice(6)) as {
                  json?: { gameTeams?: { score: number }[] };
                };
                const score = parsed.json?.gameTeams?.[0]?.score;
                if (typeof score === "number") {
                  sub.scores.push({ score, at: performance.now() });
                }
              } catch {
                // ping or non-JSON payload
              }
            }
          }
        }
      } catch {
        // aborted
      }
    })();
  })();
  return sub;
}

async function addScore(
  port: number,
  gameId: string,
  teamId: string,
  sessionToken: string,
) {
  const res = await fetch(
    `http://localhost:${port}/api/trpc/gameAdmin.addScore`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-buzz-board-game-id": gameId,
        cookie: `authjs.session-token=${sessionToken}`,
      },
      body: JSON.stringify({ json: { [teamId]: 1 } }),
    },
  );
  if (!res.ok) {
    throw new Error(`addScore failed: ${res.status} ${await res.text()}`);
  }
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!,
  );
}

async function main() {
  await redis.connect();
  const instances = PORTS.map(startInstance);
  try {
    await Promise.all(PORTS.map(waitForHttp));
    const { game, teamId, sessionToken } = await seedGame();

    const baselineRedis = await redisClients();
    const subscribers = PORTS.flatMap((port) =>
      Array.from({ length: PER_INSTANCE }, () => subscribe(port, game.id)),
    );
    await Promise.all(subscribers.map((s) => s.ready));
    // Allow lazy SUBSCRIBE calls to complete before publishing.
    await sleep(2_000);
    const withSubscribers = await redisClients();

    const rounds = 5;
    const latencies: Record<number, number[]> = { 3201: [], 3202: [] };
    for (let round = 1; round <= rounds; round++) {
      const sentAt = performance.now();
      await addScore(PORTS[0], game.id, teamId, sessionToken);
      await sleep(1_000);
      for (const sub of subscribers) {
        const hit = sub.scores.find((s) => s.score === round);
        if (hit) latencies[sub.port]!.push(hit.at - sentAt);
      }
    }

    subscribers.forEach((s) => s.controller.abort());
    await sleep(3_000);
    const afterAbort = await redisClients();

    const expected = PER_INSTANCE * rounds;
    const report = {
      when: new Date().toISOString(),
      subscribersPerInstance: PER_INSTANCE,
      mutationsSentTo: PORTS[0],
      rounds,
      delivery: Object.fromEntries(
        PORTS.map((port) => [
          port,
          {
            delivered: latencies[port]!.length,
            expected,
            p50Ms: percentile(latencies[port]!, 50),
            p95Ms: percentile(latencies[port]!, 95),
            maxMs: percentile(latencies[port]!, 100),
          },
        ]),
      ),
      sseResponseHeaders: subscribers[0]!.headers,
      redisConnections: {
        baseline: baselineRedis,
        withSubscribers,
        afterAllAborted: afterAbort,
        perSubscriber:
          (withSubscribers - baselineRedis) / (PER_INSTANCE * PORTS.length),
        leakedAfterAbort: afterAbort - baselineRedis,
      },
    };
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      "test-results/spike-two-instance.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    instances.forEach((child) => child.kill("SIGTERM"));
    await redis.quit();
    await db.$disconnect();
  }
}

await main();
