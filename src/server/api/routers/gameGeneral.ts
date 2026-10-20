import {
  createTRPCRouter,
  protectedGameGeneralProcedure,
} from "@/server/api/trpc";

import { getPrivateGameState } from "@/server/db/common";
import { liveFeeds } from "@/server/utils/events";
import { isStillStaff } from "@/server/staff/staffService";
import { TRPCError } from "@trpc/server";

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
    const gameId = ctx.gameSession.id;
    const userId = ctx.session?.user?.id;
    // Players are checked when they are removed (later PRs). A helper whose
    // role was removed stops receiving private state at the next change.
    const staffOnly =
      !("gameUser" in ctx.gameSession && ctx.gameSession.gameUser) && !!userId;
    for await (const state of liveFeeds.privateGameState.subscribe(
      gameId,
      signal,
    )) {
      if (staffOnly && !(await isStillStaff(gameId, userId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your role in this game was removed.",
        });
      }
      yield state;
    }
  }),
  /** Superseded by `buzzWinner` in the game state; kept for older open tabs. */
  whoBuzzedIn: protectedGameGeneralProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    yield* liveFeeds.whoBuzzedIn.subscribe(ctx.gameSession.id, signal);
  }),
});
