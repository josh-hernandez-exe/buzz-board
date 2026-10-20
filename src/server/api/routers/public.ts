import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedUserProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import {
  linkedPlayers,
  previewRecovery,
  redeemRecovery,
  resumeLinkedPlayer,
} from "@/server/identity/identityService";
import {
  clientAddress,
  takeRateLimit,
  type RateLimitName,
} from "@/server/utils/rateLimit";

import { getPublicGameState } from "@/server/db/common";
import { joinGame, resumePreview } from "@/server/games/gameService";
import { toTRPCError } from "@/server/api/errors";

import { emitUpdatedGameState, liveFeeds } from "@/server/utils/events";

async function enforceRateLimit(name: RateLimitName, address: string) {
  const { allowed, retryAfterSeconds } = await takeRateLimit(name, address);
  if (!allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many attempts from this network. Wait ${retryAfterSeconds} seconds and try again.`,
    });
  }
}

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
      const address = clientAddress(ctx.headers);
      await enforceRateLimit("join", address);
      const result = await joinGame({
        gameCode: input.gameCode,
        token: input.token,
        nickname: input.nickname,
      });
      if (result.isErr()) {
        if (result.error.kind === "gameNotFound") {
          await enforceRateLimit("unknownCode", address);
        }
        throw toTRPCError(result.error);
      }

      if (!result.value.resumed) {
        await emitUpdatedGameState({ gameId: result.value.gameId });
      }
      return result.value;
    }),
  /** Players in this game saved to the signed-in account. */
  linkedPlayers: publicProcedure
    .input(z.object({ gameCode: z.string().trim().toUpperCase().max(6) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session?.user?.id;
      if (!userId) return [];
      return linkedPlayers({ gameCode: input.gameCode, userId });
    }),
  /** Gets back in as a player saved to the signed-in account. */
  resumeLinked: protectedUserProcedure
    .input(
      z.object({
        gameCode: z.string().trim().toUpperCase().max(6),
        gameUserId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await resumeLinkedPlayer({
        ...input,
        userId: ctx.session.user.id,
      });
      if (result.isErr()) throw toTRPCError(result.error);
      return { ...result.value, resumed: true };
    }),
  /** What a recovery link restores, without using it. */
  recoveryPreview: publicProcedure
    .input(z.object({ token: z.string().min(16).max(200) }))
    .query(async ({ input }) => previewRecovery({ token: input.token })),
  /** Uses a recovery link once and returns the player's new credential. */
  redeemRecovery: publicProcedure
    .input(z.object({ token: z.string().min(16).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await enforceRateLimit("redeemLink", clientAddress(ctx.headers));
      const result = await redeemRecovery({ token: input.token });
      if (result.isErr()) throw toTRPCError(result.error);
      return { ...result.value, resumed: true };
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
