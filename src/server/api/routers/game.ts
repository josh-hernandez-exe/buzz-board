import { GameFormat } from "@prisma/client";
import { z } from "zod";

import { logger } from "@/utils/logger";

import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";

import { generateShortCode } from "@/utils/codeGeneration";

export const gameRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        format: z.enum([GameFormat.single, GameFormat.team]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let game;

      while (game === undefined) {
        try {
          game = await ctx.db.game.create({
            data: {
              name: input.name,
              code: generateShortCode(6),
              format: input.format,
              createdBy: {
                connect: {
                  id: ctx.session.user.id,
                },
              },
              gameAdmins: {
                create: {
                  user: {
                    connect: {
                      id: ctx.session.user.id,
                    },
                  },
                },
              },
              scoreboard: {
                create: {},
              },
              gameBuzzerState: {
                create: {},
              },
            },
          });
        } catch (e) {
          logger.error(e);
        }
      }

      return game;
    }),
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const games = await ctx.db.game.findMany({
      orderBy: { createdAt: "asc" },
      where: { createdBy: { id: ctx.session.user.id } },
      include: {
        gameUsers: true,
        gameTeams: true,
        gameAdmins: true,
        scoreboard: true,
        scoreboardStates: true,
        singleBuzzerStates: true,
        gameBuzzerState: true,
      },
    });

    return games ?? null;
  }),

  // joinGameAsGuest: publicProcedure
  //   .input(z.object({ gameCode: z.string(), token: z.optional(z.string()) }))
  //   .mutation(async ({ ctx, input }) => {
  //     const game = await ctx.db.game.findUnique({
  //       where: { code: input.gameCode },
  //     });

  //     if (!game) {
  //       throw new Error("Game not found");
  //     }

  //     const curNumPlayers = await ctx.db.gameUser.count({
  //       where: { gameId: game.id },
  //     });

  //     let guestToken;
  //     let guestGameUser;

  //     if (input?.token !== undefined) {
  //       guestGameUser = await ctx.db.gameUser.findUnique({
  //         where: { token: input?.token },
  //       });

  //       if (guestGameUser !== undefined && guestGameUser !== null) {
  //         guestToken = guestGameUser.token as string;
  //       }
  //     }

  //     if (input?.token === undefined) {
  //       guestToken = nanoid();
  //       guestGameUser = await ctx.db.gameUser.create({
  //         data: {
  //           gameId: game.id,
  //           name: `Player ${curNumPlayers + 1}`,
  //           token: guestToken,
  //         },
  //       });
  //     } else {
  //     }

  //     return { gameUser: guestGameUser, token: guestToken };
  //   }),
});
