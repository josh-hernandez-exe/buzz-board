/**
 * The table comparison behind ops:verify-restore and ops:backup-rehearsal:
 * it covers every schema, not only `public`, and never passes having
 * compared nothing.
 */
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

afterAll(async () => {
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
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

  it("fails when the source has no tables to compare", () => {
    expect(compareFingerprints([], [])).toEqual([
      "the source database has no tables, so nothing was checked (wrong URL?)",
    ]);
  });
});
