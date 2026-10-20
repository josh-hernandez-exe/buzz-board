import { execFileSync } from "node:child_process";

import { createClient } from "redis";

import {
  assertDisposableDatabase,
  testDatabaseUrl,
  testKvUrl,
} from "./testEnv";

/**
 * Resets the disposable test database to the current Prisma schema and checks
 * Redis is reachable, failing fast with a hint instead of hanging (the app's
 * Redis client retries forever when the server is missing).
 */
export default async function setup() {
  const databaseUrl = testDatabaseUrl();
  assertDisposableDatabase(databaseUrl);

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
      ["prisma", "db", "push", "--force-reset", "--skip-generate"],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "pipe",
      },
    );
  } catch (error) {
    throw new Error(
      `Could not prepare the test database at ${databaseUrl}. Run \`bun test:services:up\` first.`,
      { cause: error },
    );
  }
}
