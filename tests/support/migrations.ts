import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { assertDisposableDatabase, testDatabaseUrl } from "./testEnv";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations");

/** Lists migration directory names in the order Prisma applies them. */
export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** URL for another disposable database on the same test server. */
export function scratchDatabaseUrl(name: string): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${name}`;
  const result = url.toString();
  assertDisposableDatabase(result);
  return result;
}

/** Creates (or empties) a scratch database and returns a client for it. */
export async function freshScratchDatabase(name: string) {
  const url = scratchDatabaseUrl(name);
  const admin = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl() } },
  });
  try {
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
    );
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }
  return {
    url,
    client: new PrismaClient({ datasources: { db: { url } } }),
  };
}

export function prisma(args: string[], databaseUrl: string): string {
  return execFileSync("bunx", ["prisma", ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    stdio: "pipe",
  });
}

/**
 * Applies migration SQL files in order without recording them, so a test can
 * stop before a migration, load legacy-shaped data, then continue.
 */
export function applyMigrationSql(
  databaseUrl: string,
  { through, after }: { through?: string; after?: string } = {},
) {
  for (const name of migrationNames()) {
    if (after !== undefined && name <= after) continue;
    if (through !== undefined && name > through) break;
    prisma(
      [
        "db",
        "execute",
        "--file",
        path.join(MIGRATIONS_DIR, name, "migration.sql"),
        "--url",
        databaseUrl,
      ],
      databaseUrl,
    );
  }
}
