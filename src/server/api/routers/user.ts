import { GameFormat } from "@prisma/client";
import { z } from "zod";

import { toTRPCError } from "@/server/api/errors";
import { createTRPCRouter, protectedUserProcedure } from "@/server/api/trpc";
import { createGame, GAME_LIMITS } from "@/server/games/gameService";

import type { GameWithRelations } from "@/types";

export const userRouter = createTRPCRouter({
  game: {
    /**
     * Creates a game with its initial teams. A retried `requestId` returns the
     * game it already created instead of creating a second room.
     */
    create: protectedUserProcedure
      .input(
        z.object({
          name: z.string().max(400),
          format: z.enum([GameFormat.individual, GameFormat.team]),
          teamCount: z
            .number()
            .int()
            .min(GAME_LIMITS.minTeams)
            .max(GAME_LIMITS.maxTeams)
            .optional(),
          requestId: z
            .string()
            .min(8)
            .max(64)
            .regex(/^[A-Za-z0-9_-]+$/)
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await createGame({
          ownerId: ctx.session.user.id,
          name: input.name,
          format: input.format,
          teamCount: input.teamCount,
          requestId: input.requestId,
        });
        if (result.isErr()) throw toTRPCError(result.error);
        return result.value.game;
      }),
    /** Games the user created or helps run. */
    getAll: protectedUserProcedure.query(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      const games: GameWithRelations[] = await ctx.db.game.findMany({
        orderBy: { createdAt: "asc" },
        where: {
          OR: [{ createdById: userId }, { gameAdmins: { some: { userId } } }],
        },
        include: {
          gameUsers: true,
          gameTeams: true,
          gameAdmins: true,
        },
      });

      return games;
    }),
  },
});
