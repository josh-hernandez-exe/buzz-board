import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

import { getPublicGameState } from "@/server/db/common";
import { joinGame, resumePreview } from "@/server/games/gameService";
import { toTRPCError } from "@/server/api/errors";

import { emitUpdatedGameState, liveFeeds } from "@/server/utils/events";

export const publicRouter = createTRPCRouter({
  joinGame: publicProcedure
    .input(
      z.object({
        gameCode: z.string().trim().toUpperCase().max(6),
        token: z.string().max(200).optional(),
        /** Omitted by pre-PR05 clients; those players get "Player N". */
        nickname: z.string().max(400).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await joinGame({
        gameCode: input.gameCode,
        token: input.token,
        nickname: input.nickname,
        userId: ctx.session?.user?.id,
      });
      if (result.isErr()) throw toTRPCError(result.error);

      if (!result.value.resumed) {
        await emitUpdatedGameState({ gameId: result.value.gameId });
      }
      return result.value;
    }),
  /**
   * Who a stored credential would resume as, so the join screen can offer
   * "Resume as …" explicitly. Only the credential's holder can ask.
   */
  resumePreview: publicProcedure
    .input(
      z.object({
        gameCode: z.string().trim().toUpperCase().max(6),
        token: z.string().max(200),
      }),
    )
    .query(async ({ input }) => resumePreview(input)),
  currentGameState: publicProcedure
    .input(z.object({ gameId: z.string() }))
    .query(async ({ ctx: _, input }) => {
      const { gameId } = input;

      const result = await getPublicGameState({ gameId });
      if (result.isErr()) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }
      return result.value;
    }),

  gameState: publicProcedure
    .input(z.object({ gameId: z.string() }))
    .subscription(async function* ({ input, signal }) {
      yield* liveFeeds.publicGameState.subscribe(input.gameId, signal);
    }),
});
