import { GameFormat } from "@prisma/client";
import { z } from "zod";

import { logger } from "@/utils/logger";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

import { generateShortCode } from "@/utils/codeGeneration";

export const guestRouter = createTRPCRouter({
  game: {
    joinAsGuest: publicProcedure
      .input(z.object({ gameCode: z.string(), token: z.optional(z.string()) }))
      .mutation(async ({ ctx, input }) => {
        const { guestUser } = ctx.guestSession;

        const game = await ctx.db.game.findUnique({
          where: { code: input.gameCode },
        });

        if (!game) {
          throw new Error("Game not found");
        }

        const curNumPlayers = await ctx.db.gameUser.count({
          where: { gameId: game.id },
        });

        const guestGameUser = await ctx.db.gameUser.create({
          data: {
            gameId: game.id,
            name: `Player ${curNumPlayers + 1}`,
          },
        });

        return { gameUser: guestGameUser };
      }),
  },
});
