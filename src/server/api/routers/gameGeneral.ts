import {
  createTRPCRouter,
  protectedGameGeneralProcedure,
} from "@/server/api/trpc";

import { getPrivateGameState } from "@/server/db/common";
import { liveFeeds } from "@/server/utils/events";

import type { BasicGameInfo } from "@/types";

export const gameGeneralRouter = createTRPCRouter({
  getBasicGameInfo: protectedGameGeneralProcedure.query(async ({ ctx }) => {
    const { gameSession } = ctx;

    const game = (await ctx.db.game.findUnique({
      where: { id: gameSession.id },
      select: {
        id: true,
        name: true,
        format: true,
        code: true,
      },
    })) as BasicGameInfo;

    return game;
  }),
  currentGameState: protectedGameGeneralProcedure.query(async ({ ctx }) => {
    const { id: gameId } = ctx.gameSession;

    const result = await getPrivateGameState({ gameId });
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  }),
  gameState: protectedGameGeneralProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    yield* liveFeeds.privateGameState.subscribe(ctx.gameSession.id, signal);
  }),
  /** Superseded by `buzzWinner` in the game state; kept for older open tabs. */
  whoBuzzedIn: protectedGameGeneralProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    yield* liveFeeds.whoBuzzedIn.subscribe(ctx.gameSession.id, signal);
  }),
});
