import type { Game } from "@prisma/client";
import { GameFormat } from "@prisma/client";
import { z } from "zod";

import { logger } from "@/utils/logger";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

import { getPublicGameState, emitUpdatedGameState } from "@/server/db/common";
import { generateToken } from "@/utils/codeGeneration";

import { gameEventEmitter } from "@/utils/events";

export const publicRouter = createTRPCRouter({
  joinGame: publicProcedure
    .input(
      z.object({
        gameCode: z.string(),
        token: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const game = await ctx.db.game.findUnique({
        where: { code: input.gameCode },
        include: { gameTeams: true },
      });

      if (!game) {
        throw new Error("Game not found");
      }
      if (
        ctx.gameSession.gameUser?.token === input.token &&
        ctx.gameSession.gameUser?.gameId === game.id
      ) {
        logger.info("Game User already authenticated");
        return {
          gameUser: ctx.gameSession.gameUser,
          token: input.token,
          gameId: ctx.gameSession.id,
        };
      }

      const curMaxPlayerIndex = await ctx.db.gameUser.aggregate({
        _max: {
          index: true,
        },
        where: { gameId: game.id },
      });
      const curIndex = (curMaxPlayerIndex._max.index ?? 0) + 1;

      const gameUser = await ctx.db.$transaction(async (tx) => {
        const gUser = await tx.gameUser.create({
          data: {
            gameId: game.id,
            name: `Player ${curIndex}`,
            index: curIndex,
            token: generateToken(),
          },
        });

        if (game.format === GameFormat.single) {
          await tx.gameTeam.create({
            data: {
              gameId: game.id,
              name: gUser.name,
              index: curIndex,
              gameUsers: {
                connect: {
                  id: gUser.id,
                },
              },
            },
          });
        }
        return gUser;
      });

      if (game.format === GameFormat.single) {
        // only emit event when a new team is made
        await emitUpdatedGameState({ gameId: game.id });
      }

      return { gameUser, token: gameUser.token, gameId: game.id };
    }),
  currentGameState: publicProcedure
    .input(z.object({ gameId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { gameId } = input;

      const result = await getPublicGameState({ gameId });
      if (result.isErr()) {
        throw result.error;
      }
      return result.value;
    }),

  gameState: publicProcedure
    .input(z.object({ gameId: z.string() }))
    .subscription(async function* ({ ctx, input, signal }) {
      const { gameId } = input;

      const result = await getPublicGameState({ gameId });
      if (result.isErr()) {
        throw result.error;
      }

      yield result.value;

      for await (const [eventGameId, gameState] of gameEventEmitter.toIterable(
        "publicGameStateUpdate",
        { signal },
      )) {
        if (eventGameId === gameId) {
          yield gameState;
        }
      }
    }),
});
