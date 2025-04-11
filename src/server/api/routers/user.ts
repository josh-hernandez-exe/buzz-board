import { GameFormat } from "@prisma/client";
import { z } from "zod";

import { logger } from "@/utils/logger";

import { createTRPCRouter, protectedUserProcedure } from "@/server/api/trpc";

import { generateShortCode } from "@/utils/codeGeneration";

export const userRouter = createTRPCRouter({
  game: {
    create: protectedUserProcedure
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
              },
            });
          } catch (e) {
            logger.error(e);
          }
        }

        return game;
      }),
    getAll: protectedUserProcedure.query(async ({ ctx }) => {
      const games = await ctx.db.game.findMany({
        orderBy: { createdAt: "asc" },
        where: {
          OR: [
            { createdBy: { id: ctx.session.user.id } },
            {
              gameAdmins: {
                every: {
                  userId: ctx.session?.user.id,
                },
              },
            },
          ],
        },
        include: {
          gameUsers: true,
          gameTeams: true,
          gameAdmins: true,
          scoreboard: true,
          scoreboardStates: true,
        },
      });

      return games ?? null;
    }),
  },
});
