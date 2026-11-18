/**
 * T16 (PR02): migration baseline and populated-upgrade rehearsal. Each test
 * uses its own scratch database on the disposable test server.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  LEGACY,
  LEGACY_EXPECTED,
  seedLegacyFixture,
  snapshotLegacyData,
} from "../support/legacyFixture";
import {
  applyMigrationSql,
  freshScratchDatabase,
  migrationNames,
  prisma,
  scratchDatabaseUrl,
} from "../support/migrations";

const BASELINE = "0_init";
const clients: PrismaClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.$disconnect()));
});

async function scratch(name: string) {
  const db = await freshScratchDatabase(name);
  clients.push(db.client);
  return db;
}

describe("migrations", () => {
  it("starts from the 0_init baseline", () => {
    expect(migrationNames()[0]).toBe(BASELINE);
  });

  it("match prisma/schema.prisma exactly (no drift)", async () => {
    await scratch("buzz_board_test_shadow");

    // --exit-code exits 2 (and execFileSync throws) when there is a diff.
    const output = prisma(
      [
        "migrate",
        "diff",
        "--from-migrations",
        "prisma/migrations",
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--shadow-database-url",
        scratchDatabaseUrl("buzz_board_test_shadow"),
        "--exit-code",
      ],
      scratchDatabaseUrl("buzz_board_test_shadow"),
    );
    expect(output).toMatch(/No difference detected/);
  });

  it("deploy to an empty database and report up to date", async () => {
    const { url } = await scratch("buzz_board_test_fresh");

    prisma(["migrate", "deploy"], url);

    expect(prisma(["migrate", "status"], url)).toMatch(
      /Database schema is up to date/,
    );
  });

  it("baseline an existing `db push` deployment without touching its data", async () => {
    const { url, client } = await scratch("buzz_board_test_upgrade");
    // The baseline SQL is exactly what `db push` produced for the legacy
    // schema (proved by the drift test while 0_init was the only migration).
    applyMigrationSql(url, { through: BASELINE });
    await seedLegacyFixture(client);
    const before = await snapshotLegacyData(client);

    // Documented upgrade path for existing deployments (README).
    prisma(["migrate", "resolve", "--applied", BASELINE], url);
    prisma(["migrate", "deploy"], url);

    expect(prisma(["migrate", "status"], url)).toMatch(
      /Database schema is up to date/,
    );
    expect(await snapshotLegacyData(client)).toEqual(before);

    const scoreboard = await client.scoreboard.findUniqueOrThrow({
      where: { gameId: LEGACY.teamGame.id },
      include: { currentState: true },
    });
    expect(scoreboard.currentState?.state).toEqual(LEGACY_EXPECTED.teamScores);
    expect(scoreboard.futureStateIds).toEqual(LEGACY_EXPECTED.futureStateIds);
  });
});
