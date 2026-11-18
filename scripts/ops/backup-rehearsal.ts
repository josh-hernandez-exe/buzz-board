/**
 * Local backup-restore rehearsal: proves a backup can actually be restored,
 * and how long it takes, before you need it.
 *
 * 1. Plays a small marker game through the app's own services (players,
 *    scores, chat).
 * 2. Backs up the whole database with pg_dump.
 * 3. Restores it into a new, separate database with pg_restore.
 * 4. Compares every table (ops:verify-restore) and re-reads the marker
 *    game's scores and chat from the restored copy.
 * 5. Deletes the restored copy and the dump unless --keep.
 *
 *   bun run ops:backup-rehearsal                      # pg_dump/pg_restore on PATH
 *   bun run ops:backup-rehearsal -- --docker-container buzz-board-test-buzz-board-test-db-1
 *
 * Local and disposable databases only: it refuses anything else. For a
 * hosted database, use your provider's restore and then ops:verify-restore
 * (see docs/operations.md).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { PrismaClient } from "@prisma/client";

import { assertDisposableDatabase } from "../../tests/support/testEnv";

import { compareFingerprints, fingerprint } from "./restoreCheck";

const { values: args } = parseArgs({
  options: {
    "docker-container": { type: "string" },
    keep: { type: "boolean", default: false },
    out: { type: "string", default: "backups" },
  },
});

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) {
  console.error("Set DATABASE_URL to the local test database.");
  process.exit(2);
}
assertDisposableDatabase(sourceUrl);

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const source = new URL(sourceUrl);
const sourceDb = source.pathname.slice(1);
const restoreDb = `${sourceDb}_restore_${stamp}`;
const restoreUrl = Object.assign(new URL(sourceUrl), {
  pathname: `/${restoreDb}`,
}).toString();
mkdirSync(args.out, { recursive: true });
const dumpFile = `${args.out}/rehearsal-${stamp}.dump`;

/** Runs a PostgreSQL tool, inside the database container if asked. */
function pgTool(tool: string, toolArgs: string[], url: string, input?: Buffer) {
  const container = args["docker-container"];
  let command = tool;
  let fullArgs = [...toolArgs, `--dbname=${url}`];
  if (container) {
    // Inside the container the database listens on its own default port.
    const inner = new URL(url);
    inner.hostname = "localhost";
    inner.port = "5432";
    command = "docker";
    fullArgs = [
      "exec",
      "-i",
      container,
      tool,
      ...toolArgs,
      `--dbname=${inner}`,
    ];
  }
  const result = spawnSync(command, fullArgs, {
    input,
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0) {
    throw new Error(
      `${tool} failed: ${result.stderr?.toString() || result.error?.message}`,
    );
  }
  return result.stdout;
}

const timings: Record<string, number> = {};
async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const t0 = performance.now();
  const value = await fn();
  timings[name] = Math.round(performance.now() - t0);
  return value;
}

const admin = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
let restoreCreated = false;

try {
  // 1. A marker game played through the real services.
  const marker = await step("seed", async () => {
    const { createGame, joinGame } = await import("@/server/games/gameService");
    const { runScoreCommand } = await import("@/server/scores/scoreService");
    const { sendMessage, setChatEnabled } = await import(
      "@/server/chat/chatService"
    );
    const owner = await admin.user.create({
      data: {
        name: "Rehearsal owner",
        email: `rehearsal-${stamp}@example.test`,
      },
    });
    const created = (
      await createGame({
        ownerId: owner.id,
        name: `Restore rehearsal ${stamp}`,
        format: "team",
        teamCount: 3,
      })
    )._unsafeUnwrap().game;
    await setChatEnabled(created.id, true);
    const teams = await admin.gameTeam.findMany({
      where: { gameId: created.id },
      orderBy: { index: "asc" },
    });
    const players = [];
    for (const name of ["Ada", "Bo", "Cy"]) {
      players.push(
        (
          await joinGame({ gameCode: created.code, nickname: name })
        )._unsafeUnwrap(),
      );
    }
    await runScoreCommand({
      gameId: created.id,
      actorUserId: owner.id,
      requestId: `rehearsal-${stamp}-1`,
      command: {
        kind: "add",
        changes: { [teams[0]!.id]: 30, [teams[1]!.id]: 25, [teams[2]!.id]: 8 },
      },
    });
    const player = players[0]!.gameUser;
    await sendMessage({
      gameId: created.id,
      actor: {
        kind: "player",
        gameUserId: player.id,
        gameTeamId: player.gameTeamId,
      },
      channelKey: "game",
      body: `Marker message ${stamp}`,
      requestId: `rehearsal${stamp}`,
    }).then((r) => r._unsafeUnwrap());
    return { gameId: created.id, scores: [30, 25, 8] };
  });

  // 2. Back up.
  const dump = await step("backup", () =>
    pgTool("pg_dump", ["--format=custom", "--no-owner"], sourceUrl),
  );
  writeFileSync(dumpFile, dump);

  // 3. Restore into a new database.
  await step("restore", async () => {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${restoreDb}"`);
    restoreCreated = true;
    pgTool("pg_restore", ["--no-owner", "--exit-on-error"], restoreUrl, dump);
  });

  // 4. Verify: every table, then the marker game read back.
  const differences = await step("verify", async () =>
    compareFingerprints(
      await fingerprint(sourceUrl),
      await fingerprint(restoreUrl),
    ),
  );
  const restored = new PrismaClient({
    datasources: { db: { url: restoreUrl } },
  });
  const markerCheck = await step("markerCheck", async () => {
    const teams = await restored.gameTeam.findMany({
      where: { gameId: marker.gameId },
      orderBy: { index: "asc" },
      select: { id: true },
    });
    const effects = await restored.scoreEffect.groupBy({
      by: ["gameTeamId"],
      where: { gameId: marker.gameId },
      _sum: { delta: true },
    });
    const scores = teams.map(
      (t) => effects.find((e) => e.gameTeamId === t.id)?._sum.delta ?? 0,
    );
    const chat = await restored.chatMessage.findFirst({
      where: { gameId: marker.gameId },
      select: { body: true },
    });
    const players = await restored.gameUser.count({
      where: { gameId: marker.gameId },
    });
    await restored.$disconnect();
    return {
      scores,
      scoresMatch: JSON.stringify(scores) === JSON.stringify(marker.scores),
      chatMatches: chat?.body === `Marker message ${stamp}`,
      players,
    };
  });

  const report = {
    ok:
      differences.length === 0 &&
      markerCheck.scoresMatch &&
      markerCheck.chatMatches &&
      markerCheck.players === 3,
    at: new Date().toISOString(),
    dumpBytes: statSync(dumpFile).size,
    timingsMs: timings,
    differences,
    markerCheck,
  };
  writeFileSync(
    `${args.out}/rehearsal-${stamp}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (!args.keep) {
    if (restoreCreated) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${restoreDb}" WITH (FORCE)`,
      );
    }
    rmSync(dumpFile, { force: true });
  }
  await admin.$disconnect();
  const { db } = await import("@/server/db");
  await db.$disconnect();
  // The app's Redis clients would otherwise keep the process alive.
  process.exit(process.exitCode ?? 0);
}
