import { GameFormat } from "@prisma/client";
import { z } from "zod";

import { logger } from "@/utils/logger";

import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

import { generateShortCode } from "@/utils/codeGeneration";

export const guestRouter = createTRPCRouter({
  game: {
    joinAsGuest: publicProcedure
      .input(
        z.object({
          gameCode: z.string(),
          token: z.optional(z.string()),
          gameTeamId: z.optional(z.string()),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { guestUser } = ctx.guestSession;
        const game = await ctx.db.game.findUnique({
          where: { code: input.gameCode },
          include: { gameTeams: true },
        });

        if (!game) {
          throw new Error("Game not found");
        }

        if (game.format === GameFormat.team && input.gameTeamId) {
          const team = game.gameTeams.find((t) => t.id === input.gameTeamId);
          if (!team) {
            throw new Error("Invalid team selection");
          }
        }

        const curNumPlayers = await ctx.db.gameUser.count({
          where: { gameId: game.id },
        });

        const guestGameUser = await ctx.db.gameUser.create({
          data: {
            gameId: game.id,
            name: `Player ${curNumPlayers + 1}`,
            gameTeamId: input.gameTeamId || null,
          },
        });

        return { gameUser: guestGameUser, token: guestUser?.token };
      }),
    createGuestUser: publicProcedure
      .input(
        z.object({
          name: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const guestUser = await ctx.db.guestUser.create({
          data: {
            // TODO: replace shortcode generation with better security
            token: generateShortCode(30),
          },
        });

        return { guestUser };
      }),
  },
});
