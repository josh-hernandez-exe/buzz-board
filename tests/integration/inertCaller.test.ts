import { describe, expect, it } from "vitest";

import { createCaller } from "@/server/api/root";

import { inertCaller } from "@/server/api/inertCaller";

async function unhandledDuring(run: () => unknown) {
  const seen: unknown[] = [];
  const on = (e: unknown) => seen.push(e);
  process.on("unhandledRejection", on);
  try {
    await run();
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    process.off("unhandledRejection", on);
  }
  return seen;
}

describe("inertCaller", () => {
  it("can be serialized and awaited without calling a missing procedure", async () => {
    const caller = inertCaller(createCaller({} as never));
    expect(
      await unhandledDuring(async () => {
        JSON.stringify({ caller });
        expect(await Promise.resolve(caller)).toBe(caller);
      }),
    ).toEqual([]);
    // Real procedures are still reachable.
    expect(typeof caller.public.currentGameState).toBe("function");
  });
});
