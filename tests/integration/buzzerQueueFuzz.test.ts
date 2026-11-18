/**
 * Randomised queue sessions against the real database: hosts open, close,
 * move on, judge, undo, redo, switch modes and delete teams while players
 * buzz, and the queue's rules are checked after every step. A failure
 * prints the seed and the steps so far.
 */
import type { BuzzQueueStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createGame, db, joinAsGuest } from "../support/integration";

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  };
}

async function invariants(gameId: string, where: string) {
  const game = await db.game.findUniqueOrThrow({ where: { id: gameId } });
  const teams = await db.gameTeam.findMany({ where: { gameId } });
  const entries = await db.buzzQueueEntry.findMany({
    where: { gameId, window: game.buzzerWindow },
    orderBy: { position: "asc" },
  });
  const teamIds = new Set(teams.map((t) => t.id));
  const by = (s: BuzzQueueStatus) => entries.filter((e) => e.status === s);
  const answering = by("answering");
  const correct = by("correct");
  const waiting = by("waiting");

  expect(
    new Set(entries.map((e) => e.position)).size,
    `${where}: positions repeat`,
  ).toBe(entries.length);
  expect(
    game.buzzerWindow <= game.buzzerWindowHigh,
    `${where}: window above high-water mark`,
  ).toBe(true);
  if (game.buzzerMode !== "queue") return;

  expect(answering.length <= 1, `${where}: two teams answering`).toBe(true);
  expect(correct.length <= 1, `${where}: two correct answers`).toBe(true);
  if (correct.length > 0) {
    expect(game.isBuzzerListening, `${where}: open after correct`).toBe(false);
    expect(answering.length, `${where}: answering after correct`).toBe(0);
  }
  if (waiting.length > 0 && correct.length === 0) {
    expect(
      answering.length,
      `${where}: teams waiting but nobody answering`,
    ).toBe(1);
  }
  for (const e of [...answering, ...waiting]) {
    expect(teamIds.has(e.gameTeamId), `${where}: deleted team in line`).toBe(
      true,
    );
  }
  const active = [...answering, ...waiting].map((e) => e.gameTeamId);
  expect(new Set(active).size, `${where}: a team twice in line`).toBe(
    active.length,
  );
  const selected = teams.filter((t) => t.buzzerState === "selected");
  if (answering[0]) {
    expect(
      selected.map((t) => t.id),
      `${where}: answering team not the selected one`,
    ).toEqual([answering[0].gameTeamId]);
  } else {
    // Only the team that got it right stays highlighted.
    expect(
      selected.map((t) => t.id),
      `${where}: a team selected with nobody answering`,
    ).toEqual(correct.map((e) => e.gameTeamId).filter((id) => teamIds.has(id)));
  }
  for (const e of by("wrong")) {
    const team = teams.find((t) => t.id === e.gameTeamId);
    if (team && !active.includes(team.id)) {
      expect(team.buzzerState, `${where}: wrong team not locked out`).toBe(
        "rejected",
      );
    }
  }
}

async function session(seed: number) {
  const r = rng(seed);
  const created = await createGame({ teams: 4 });
  const { admin, game } = created;
  await admin.gameAdmin.buzzer.setMode({ mode: "queue" });
  const players: { buzz: () => Promise<unknown> }[] = [];
  for (const team of created.gameTeams) {
    const guest = await joinAsGuest(game.code);
    await guest.player.gameUser.changeTeams({ gameTeamId: team.id });
    players.push({ buzz: () => guest.player.gameUser.buzzIn() });
  }
  const log: string[] = [];
  const attempt = async (name: string, fn: () => Promise<unknown>) => {
    log.push(name);
    // Refusals (nothing to undo, buzzer closed, team locked out) are fine;
    // only the state afterwards matters.
    await fn().catch(() => undefined);
  };

  for (let step = 0; step < 45; step++) {
    const g = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    const entries = await db.buzzQueueEntry.findMany({
      where: { gameId: game.id, window: g.buzzerWindow },
    });
    const roll = r.int(100);
    if (roll < 35) {
      // Two players buzz at once sometimes.
      const who = [
        r.pick(players),
        ...(r.chance(0.3) ? [r.pick(players)] : []),
      ];
      await attempt("buzz", () => Promise.all(who.map((p) => p.buzz())));
    } else if (roll < 55 && entries.length > 0) {
      const e = r.pick(entries);
      const verdict = r.pick(["correct", "wrong", "skip"] as const);
      await attempt(`judge ${verdict}`, () =>
        admin.gameAdmin.buzzer.judge({ entryId: e.id, verdict }),
      );
    } else if (roll < 65) {
      await attempt("open", () => admin.gameAdmin.startBuzzer());
    } else if (roll < 70) {
      await attempt("close", () => admin.gameAdmin.pauseBuzzer());
    } else if (roll < 75) {
      await attempt("next", () => admin.gameAdmin.resetBuzzer());
    } else if (roll < 87) {
      await attempt("undo", () => admin.gameAdmin.buzzer.undo());
    } else if (roll < 93) {
      await attempt("redo", () => admin.gameAdmin.buzzer.redo());
    } else if (roll < 96) {
      const mode = r.pick(["first", "queue"] as const);
      await attempt(`mode ${mode}`, () =>
        admin.gameAdmin.buzzer.setMode({ mode }),
      );
    } else {
      const teams = await db.gameTeam.findMany({ where: { gameId: game.id } });
      if (teams.length > 2) {
        await attempt("delete team", () =>
          admin.gameAdmin.removeTeam({ gameTeamId: r.pick(teams).id }),
        );
      }
    }
    await invariants(game.id, `seed ${seed} after [${log.join(", ")}]`);
  }
}

// More seeds for a soak: FUZZ_SEEDS=400 bunx vitest run --project integration tests/integration/buzzerQueueFuzz.test.ts
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 25);

describe("randomised queue sessions keep the queue's rules", () => {
  it(
    "over many seeds",
    { timeout: Math.max(300_000, SEEDS * 5_000) },
    async () => {
      for (let seed = 1; seed <= SEEDS; seed++) await session(seed);
    },
  );
});
