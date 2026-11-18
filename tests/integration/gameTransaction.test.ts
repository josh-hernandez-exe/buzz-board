/**
 * PR02: the shared per-game transaction primitive that score, buzzer and roster
 * writers build on.
 */
import { describe, expect, it } from "vitest";

import { withGameLock } from "@/server/db/gameTransaction";

import { createGame, db } from "../support/integration";

async function readCounter(gameId: string) {
  const game = await db.game.findUniqueOrThrow({ where: { id: gameId } });
  return (game.data as { counter?: number }).counter ?? 0;
}

describe("withGameLock", () => {
  it("serializes read-modify-write on the same game", async () => {
    const { game } = await createGame({ teams: 0 });

    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        withGameLock(game.id, async (tx) => {
          const current = await tx.game.findUniqueOrThrow({
            where: { id: game.id },
          });
          const counter = (current.data as { counter?: number }).counter ?? 0;
          await tx.game.update({
            where: { id: game.id },
            data: { data: { counter: counter + 1 } },
          });
          return counter + 1;
        }),
      ),
    );

    expect(results.every((r) => r.isOk())).toBe(true);
    expect(results.map((r) => r._unsafeUnwrap()).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(await readCounter(game.id)).toBe(25);
  });

  it("does not make different games wait for each other", async () => {
    const first = await createGame({ teams: 0 });
    const second = await createGame({ teams: 0 });
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => (firstStarted = resolve));

    const holding = withGameLock(first.game.id, async () => {
      firstStarted();
      await firstHeld;
    });
    await started;

    const other = await withGameLock(second.game.id, async () => "done", {
      maxWait: 1_000,
    });
    releaseFirst();
    await holding;

    expect(other._unsafeUnwrap()).toBe("done");
  });

  it("reports an unknown game without running the work", async () => {
    let ran = false;

    const result = await withGameLock("no-such-game", async () => {
      ran = true;
    });

    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: "gameNotFound" });
    expect(ran).toBe(false);
  });

  it("rolls back and rethrows errors from the work", async () => {
    const { game } = await createGame({ teams: 0 });

    await expect(
      withGameLock(game.id, async (tx) => {
        await tx.game.update({
          where: { id: game.id },
          data: { data: { counter: 99 } },
        });
        throw new Error("domain rule rejected the change");
      }),
    ).rejects.toThrow("domain rule rejected the change");

    expect(await readCounter(game.id)).toBe(0);
  });

  it("reports busy instead of waiting forever when the lock is held too long", async () => {
    const { game } = await createGame({ teams: 0 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const holderStarted = new Promise<void>((resolve) => (started = resolve));

    const holder = withGameLock(game.id, async () => {
      started();
      await held;
      return "holder";
    });
    await holderStarted;

    let ran = false;
    const waiter = await withGameLock(
      game.id,
      async () => {
        ran = true;
      },
      { lockTimeoutMs: 200 },
    );
    release();

    expect(waiter._unsafeUnwrapErr()).toMatchObject({ kind: "busy" });
    expect(ran).toBe(false);
    expect((await holder)._unsafeUnwrap()).toBe("holder");
  });
});
