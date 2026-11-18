/**
 * The public scoreboard says "Game not found" only for a missing game; other
 * failures must reach Next's error handling instead of looking like a 404.
 */
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentGameState } = vi.hoisted(() => ({
  currentGameState: vi.fn(),
}));

vi.mock("@/trpc/server", () => ({
  api: { public: { currentGameState } },
  HydrateClient: () => null,
}));
vi.mock("@/app/_components/ui/page", () => ({
  MessagePage: () => null,
  PageShell: () => null,
}));
vi.mock("@/app/game/[gameId]/scoreboard/public/PublicScoreboard", () => ({
  PublicScoreboard: () => null,
}));

const { MessagePage } = await import("@/app/_components/ui/page");
const { default: GamePage } =
  await import("@/app/game/[gameId]/scoreboard/public/page");

const render = () => GamePage({ params: Promise.resolve({ gameId: "g1" }) });

describe("public scoreboard page", () => {
  beforeEach(() => {
    currentGameState.mockReset();
  });

  it("shows Game not found when the game doesn't exist", async () => {
    currentGameState.mockRejectedValue(
      new TRPCError({ code: "NOT_FOUND", message: "Game not found" }),
    );

    await expect(render()).resolves.toMatchObject({
      type: MessagePage,
      props: { title: "Game not found" },
    });
  });

  it.each([
    new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Redis down" }),
    new Error("Database unreachable"),
  ])("rethrows other failures ($message)", async (failure) => {
    currentGameState.mockRejectedValue(failure);

    await expect(render()).rejects.toBe(failure);
  });
});
