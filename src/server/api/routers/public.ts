import { GameFormat } from "@prisma/client";
import { z } from "zod";

import { logger } from "@/utils/logger";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

import { generateShortCode } from "@/utils/codeGeneration";

export const publicRouter = createTRPCRouter({
  joinGame: publicProcedure
    .input(
      z.object({
        gameCode: z.string(),
        token: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.gameSession.gameUser?.token === input.token) {
        logger.info("Game User already authenticated");
        return {
          gameUser: ctx.gameSession.gameUser,
          token: input.token,
          gameId: ctx.gameSession.id,
        };
      }

      const game = await ctx.db.game.findUnique({
        where: { code: input.gameCode },
        include: { gameTeams: true },
      });

      if (!game) {
        throw new Error("Game not found");
      }

      const curNumPlayers = await ctx.db.gameUser.count({
        where: { gameId: game.id },
      });

      const gameUser = await ctx.db.gameUser.create({
        data: {
          gameId: game.id,
          name: `Player ${curNumPlayers + 1}`,
          // TODO: replace shortcode generation with better security
          token: generateShortCode(30),
        },
      });

      return { gameUser, token: gameUser.token, gameId: game.id };
    }),
});
