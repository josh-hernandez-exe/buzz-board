import { execFileSync } from "node:child_process";

import { createClient } from "redis";

import {
  assertDisposableDatabase,
  assertDisposableRedis,
  testDatabaseUrl,
  testKvUrl,
} from "./testEnv";

/**
 * Resets the disposable test database by applying the checked-in migrations
 * (so every run exercises them) and checks
 * Redis is reachable, failing fast with a hint instead of hanging (the app's
 * Redis client retries forever when the server is missing).
 */
export default async function setup() {
  const databaseUrl = testDatabaseUrl();
  assertDisposableDatabase(databaseUrl);
  assertDisposableRedis(testKvUrl());

  const redis = createClient({
    url: testKvUrl(),
    socket: { connectTimeout: 2_000, reconnectStrategy: false },
  });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(
      `Test Redis is not reachable at ${testKvUrl()}. Run \`bun test:services:up\` first.`,
      { cause: error },
    );
  } finally {
    if (redis.isOpen) {
      await redis.quit();
    }
  }

  try {
    execFileSync(
      "bunx",
      [
        "prisma",
        "migrate",
        "reset",
        "--force",
        "--skip-seed",
        "--skip-generate",
      ],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "pipe",
      },
    );
  } catch (error) {
    // Only an unreachable server means the services are down; anything else
    // (for example a failing migration) is reported with Prisma's output.
    const { stderr } = error as { stderr?: Buffer | string };
    const output = (stderr?.toString() ?? "").trim();
    throw new Error(
      output.includes("P1001")
        ? `Test PostgreSQL is not reachable at ${databaseUrl}. Run \`bun test:services:up\` first.`
        : `Resetting the test database with the checked-in migrations failed:\n${output}`,
      { cause: error },
    );
  }
}
