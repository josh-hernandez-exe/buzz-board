import { gridRulesSchema } from "@/utils/categoryGrid/content";
import { rulesSchema } from "@/utils/rankedAnswers/content";
import { TRPCError } from "@trpc/server";
import { BuzzerMode, GameFormat } from "@prisma/client";
import { z } from "zod";

import { toTRPCError } from "@/server/api/errors";
import {
  createTRPCRouter,
  protectedUserProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import {
  acceptStaffInvite,
  previewStaffInvite,
  staffRoleFor,
} from "@/server/staff/staffService";
import { emitUpdatedGameState } from "@/server/utils/events";
import {
  createGame,
  deleteGame,
  GAME_LIMITS,
} from "@/server/games/gameService";

import type { DashboardGame } from "@/types";

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
          /** "queue": every buzz queues in order. Default: first buzz wins. */
          buzzerMode: z.enum([BuzzerMode.first, BuzzerMode.queue]).optional(),
          /** Set the game up for Ranked Answers with these rules. */
          rankedAnswers: z
            .object({
              rules: rulesSchema,
              sampleBoards: z.boolean().optional(),
            })
            .optional(),
          /** Or set it up for Category Grid with these rules. */
          categoryGrid: z
            .object({
              rules: gridRulesSchema,
              sampleGrid: z.boolean().optional(),
            })
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
          buzzerMode: input.buzzerMode,
          rankedAnswers: input.rankedAnswers,
          categoryGrid: input.rankedAnswers ? undefined : input.categoryGrid,
          requestId: input.requestId,
        });
        if (result.isErr()) throw toTRPCError(result.error);
        return result.value.game;
      }),
    /** Games the user created or helps run. */
    /**
     * Games the caller owns or helps run, newest first. Counts only: player
     * rows (and their credentials) never leave the server here.
     */
    getAll: protectedUserProcedure.query(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      const games = await ctx.db.game.findMany({
        orderBy: { createdAt: "desc" },
        where: {
          OR: [{ createdById: userId }, { gameAdmins: { some: { userId } } }],
        },
        select: {
          id: true,
          name: true,
          code: true,
          format: true,
          status: true,
          createdAt: true,
          finishedAt: true,
          createdById: true,
          gameAdmins: {
            where: { userId },
            select: { userId: true, role: true },
          },
          _count: {
            select: {
              gameTeams: true,
              gameUsers: { where: { removedAt: null } },
            },
          },
        },
      });

      return games.flatMap((game): DashboardGame[] => {
        const myRole = staffRoleFor({
          createdById: game.createdById,
          gameAdmin: game.gameAdmins[0],
          userId,
        });
        if (!myRole) return [];
        return [
          {
            id: game.id,
            name: game.name,
            code: game.code,
            format: game.format,
            status: game.status,
            createdAt: game.createdAt,
            finishedAt: game.finishedAt,
            numTeams: game._count.gameTeams,
            numPlayers: game._count.gameUsers,
            myRole,
          },
        ];
      });
    }),
  },
  /**
   * Deletes one of the caller's games from the dashboard. The service checks
   * the caller is the owner and that the typed name matches.
   */
  deleteGame: protectedUserProcedure
    .input(
      z.object({
        gameId: z.string().max(64),
        confirmName: z.string().max(200),
        finishFirst: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const exists = await ctx.db.game.findUnique({
        where: { id: input.gameId },
        select: { id: true },
      });
      if (!exists) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That game no longer exists.",
        });
      }
      const result = await deleteGame({
        gameId: input.gameId,
        actorUserId: ctx.session.user.id,
        confirmName: input.confirmName,
        finishFirst: input.finishFirst,
      });
      if (result.isErr()) throw toTRPCError(result.error);
      // Open pages for this game learn it's gone.
      await emitUpdatedGameState({ gameId: input.gameId });
      return result.value;
    }),
  invite: {
    /** Shows a staff invitation without using it (safe for link previews). */
    preview: publicProcedure
      .input(z.object({ token: z.string().min(16).max(200) }))
      .query(async ({ ctx, input }) =>
        previewStaffInvite({
          token: input.token,
          userId: ctx.session?.user?.id,
        }),
      ),
    /** Accepts a staff invitation for the signed-in account. */
    accept: protectedUserProcedure
      .input(z.object({ token: z.string().min(16).max(200) }))
      .mutation(async ({ ctx, input }) => {
        const result = await acceptStaffInvite({
          token: input.token,
          userId: ctx.session.user.id,
        });
        if (result.isErr()) throw toTRPCError(result.error);
        if (result.value.changed) {
          await emitUpdatedGameState({ gameId: result.value.gameId });
        }
        return result.value;
      }),
  },
});
