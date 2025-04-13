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

      const curNumPlayers = await ctx.db.gameUser.count({
        where: { gameId: game.id },
      });
      const curIndex = curNumPlayers + 1;

      const gameUser = await ctx.db.$transaction(async (tx) => {
        const gUser = await tx.gameUser.create({
          data: {
            gameId: game.id,
            name: `Player ${curIndex}`,
            // TODO: replace shortcode generation with better security
            token: generateShortCode(30),
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

      return { gameUser, token: gameUser.token, gameId: game.id };
    }),
  getGameInfo: publicProcedure
    .input(z.object({ gameId: z.string() }))
    .query(async ({ ctx, input }) => {
      const game = await ctx.db.game.findUnique({
        select: {
          id: true,
          name: true,
          format: true,
          isBuzzerListening: true,
          gameTeams: {
            select: {
              id: true,
              name: true,
              buzzerState: true,
              _count: {
                select: {
                  gameUsers: true,
                },
              },
            },
          },
          scoreboard: {
            select: {
              currentState: {
                select: {
                  state: true,
                },
              },
            },
          },
        },
        where: {
          id: input.gameId,
        },
      });

      if (!game) {
        throw new Error("Game not found");
      }
      if (!game.scoreboard) {
        throw new Error("Game does not have a scoreboard");
      }
      if (!game.scoreboard.currentState) {
        throw new Error("Game does not have a current scoreboard state");
      }

      return game;
    }),
});
