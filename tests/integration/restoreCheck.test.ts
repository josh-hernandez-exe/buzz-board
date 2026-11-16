/**
 * The table comparison behind ops:verify-restore and ops:backup-rehearsal:
 * it covers every schema, not only `public`, never passes having compared
 * nothing, and doesn't depend on the server's locale or session defaults.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  compareFingerprints,
  fingerprint,
} from "../../scripts/ops/restoreCheck";
import { db } from "../support/integration";
import { testDatabaseUrl } from "../support/testEnv";

const SCHEMA = "restore_check_extra";

beforeAll(async () => {
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
  await db.$executeRawUnsafe(
    `CREATE TABLE ${SCHEMA}.items (id int PRIMARY KEY, label text)`,
  );
  await db.$executeRawUnsafe(`INSERT INTO ${SCHEMA}.items VALUES (1, 'kept')`);
});

const scratchNames: string[] = [];

/**
 * A database on the disposable test server holding the same rows as every
 * other scratch database, differing only in locale and session defaults.
 */
async function scratchDatabase(
  name: string,
  locale: string,
  settings: string[] = [],
) {
  scratchNames.push(name);
  await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await db.$executeRawUnsafe(
    `CREATE DATABASE ${name} TEMPLATE template0 ${locale}`,
  );
  for (const setting of settings) {
    await db.$executeRawUnsafe(`ALTER DATABASE ${name} SET ${setting}`);
  }
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${name}`;
  const scratch = new PrismaClient({
    datasources: { db: { url: url.toString() } },
  });
  try {
    await scratch.$executeRawUnsafe(
      `CREATE TABLE items (label text, at timestamptz, gap interval, ratio float8, raw bytea)`,
    );
    await scratch.$executeRawUnsafe(
      `INSERT INTO items VALUES
         ('a', '2026-01-02T03:04:05Z', '1 day 02:03:04', 0.1::float8 + 0.2, '\\xdead'),
         ('B', '2026-06-07T08:09:10Z', '-3 hours', 1e-7, '\\x00ff')`,
    );
  } finally {
    await scratch.$disconnect();
  }
  return url.toString();
}

afterAll(async () => {
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  for (const name of scratchNames) {
    await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
});

describe("restore check", () => {
  it("checks tables outside the public schema too", async () => {
    const source = await fingerprint(testDatabaseUrl());
    expect(source.find((t) => t.table === `${SCHEMA}.items`)).toMatchObject({
      rows: 1,
    });
    expect(source.some((t) => t.table === "public._prisma_migrations")).toBe(
      true,
    );

    const restored = source.filter((t) => !t.table.startsWith(`${SCHEMA}.`));
    expect(compareFingerprints(source, restored)).toEqual([
      `${SCHEMA}.items: missing from the restored database`,
    ]);
  });

  it("matches identical data restored onto a server with another locale and settings", async () => {
    const original = await scratchDatabase("restore_check_c", "LOCALE 'C'");
    const restored = await scratchDatabase(
      "restore_check_icu",
      "LOCALE_PROVIDER icu ICU_LOCALE 'und' LOCALE 'C'",
      [
        "TimeZone = 'Pacific/Auckland'",
        "DateStyle = 'SQL, DMY'",
        "IntervalStyle = 'sql_standard'",
        "extra_float_digits = 0",
        "bytea_output = 'escape'",
      ],
    );

    const [a, b] = await Promise.all([
      fingerprint(original),
      fingerprint(restored),
    ]);
    expect(a).toHaveLength(1);
    expect(compareFingerprints(a, b)).toEqual([]);
  });

  it("fails when the source has no tables to compare", () => {
    expect(compareFingerprints([], [])).toEqual([
      "the source database has no tables, so nothing was checked (wrong URL?)",
    ]);
  });
});
