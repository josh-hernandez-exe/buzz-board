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
    });

    return games ?? null;
  }),
});
