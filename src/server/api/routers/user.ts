import { GameFormat } from "@prisma/client";
import { z } from "zod";

import { createTRPCRouter, protectedUserProcedure } from "@/server/api/trpc";
import { generateShortCode } from "@/server/utils/codeGeneration";

import type { GameWithRelations } from "@/types";

export const userRouter = createTRPCRouter({
  game: {
    create: protectedUserProcedure
      .input(
        z.object({
          name: z.string().min(1),
          format: z.enum([GameFormat.individual, GameFormat.team]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        let shortcode: string | undefined;

        // Generate a unique shortcode
        while (shortcode === undefined) {
          shortcode = generateShortCode(6);
          const g = await ctx.db.game.findUnique({
            select: {
              id: true,
              code: true,
            },
            where: {
              code: shortcode,
            },
          });
          if (g?.code === shortcode) {
            // short code exists, generate a new one
            shortcode = undefined;
          }
        }

        const game = await ctx.db.$transaction(async (tx) => {
          const g = await tx.game.create({
            data: {
              name: input.name,
              code: shortcode,
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
            include: {
              scoreboard: true,
            },
          });

          const { scoreboard, ...game } = g;

          const scoreboardState = await tx.scoreboardState.create({
            data: {
              game: {
                connect: {
                  id: game.id,
                },
              },
              scoreboard: {
                connect: {
                  id: scoreboard?.id,
                },
              },
            },
          });

          await tx.scoreboard.update({
            where: {
              id: scoreboard?.id,
            },
            data: {
              currentStateId: scoreboardState.id,
            },
          });
          return game;
        });

        return game;
      }),
    getAll: protectedUserProcedure.query(async ({ ctx }) => {
      const games: GameWithRelations[] = await ctx.db.game.findMany({
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
        },
      });

      return games ?? null;
    }),
  },
});
