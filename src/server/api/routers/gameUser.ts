import { GameFormat } from "@prisma/client";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { logger } from "@/logger";

import {
  createTRPCRouter,
  protectedGameUserProcedure,
} from "@/server/api/trpc";

import { emitUpdatedGameState } from "@/server/utils/events";
import { buzzIn } from "@/server/buzzer/buzzerService";
import { toTRPCError } from "@/server/api/errors";
import {
  movePlayer,
  renamePlayer,
  renameTeam,
} from "@/server/roster/rosterService";
import { linkPlayerToAccount } from "@/server/identity/identityService";
import type { GameUserWithRelations, GameTeamWithRelations } from "@/types";

export const gameUserRouter = createTRPCRouter({
  ping: protectedGameUserProcedure.query(({ ctx }) => {
    const { gameUser } = ctx.gameSession;
    logger.info(`Ping from game user: ${gameUser.id}`);
    return "pong";
  }),
  getSelfInfo: protectedGameUserProcedure.query(async ({ ctx }) => {
    const gameUser = (await ctx.db.gameUser.findUnique({
      select: {
        id: true,
        name: true,
        index: true,
        data: true,
        gameId: true,
        gameTeamId: true,
        gameTeam: {
          select: {
            id: true,
            name: true,
            index: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
      where: {
        id: ctx.gameSession.gameUser.id,
      },
    })) as GameUserWithRelations;

    if (!gameUser) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Game user not found",
      });
    }
    return gameUser;
  }),
  getSelfTeamInfo: protectedGameUserProcedure.query(async ({ ctx }) => {
    const { gameUser } = ctx.gameSession;

    if (!gameUser.gameTeamId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "GameUser is not on a team.",
      });
    }
    if (ctx.gameSession.format !== GameFormat.team) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Game format does not support teams",
      });
    }

    const gameTeam = (await ctx.db.gameTeam.findUnique({
      select: {
        id: true,
        name: true,
        index: true,
        gameId: true,
        gameUsers: {
          select: {
            id: true,
            name: true,
            index: true,
            user: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
      },
      where: {
        id: gameUser.gameTeamId,
      },
    })) as GameTeamWithRelations;

    if (!gameTeam) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Game team not found",
      });
    }

    return gameTeam;
  }),
  changeName: protectedGameUserProcedure
    .input(
      z.object({
        name: z.string().max(400),
        /** The name version the editor loaded; a newer name is not overwritten. */
        expectedNameVersion: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { gameUser } = ctx.gameSession;
      const result = await renamePlayer({
        gameId: ctx.gameSession.id,
        gameUserId: gameUser.id,
        name: input.name,
        expectedNameVersion: input.expectedNameVersion,
        actor: { kind: "player", gameUserId: gameUser.id },
      });
      if (result.isErr()) throw toTRPCError(result.error);
      if (result.value.changed) {
        await emitUpdatedGameState({ gameId: ctx.gameSession.id });
      }
      return {
        id: gameUser.id,
        name: result.value.name,
        nameVersion: result.value.nameVersion,
        index: gameUser.index,
        gameId: gameUser.gameId,
        gameTeamId: gameUser.gameTeamId,
        userId: gameUser.userId,
      };
    }),
  changeTeamName: protectedGameUserProcedure
    .input(
      z.object({
        name: z.string().max(400),
        expectedNameVersion: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { gameUser } = ctx.gameSession;
      if (!gameUser.gameTeamId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "GameUser is not on a team.",
        });
      }
      const result = await renameTeam({
        gameId: ctx.gameSession.id,
        gameTeamId: gameUser.gameTeamId,
        name: input.name,
        expectedNameVersion: input.expectedNameVersion,
        actor: { kind: "player", gameUserId: gameUser.id },
      });
      if (result.isErr()) throw toTRPCError(result.error);
      if (result.value.changed) {
        await emitUpdatedGameState({ gameId: ctx.gameSession.id });
      }
      return {
        id: gameUser.gameTeamId,
        name: result.value.name,
        nameVersion: result.value.nameVersion,
        gameId: gameUser.gameId,
      };
    }),
  changeTeams: protectedGameUserProcedure
    .input(
      z.object({
        gameTeamId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { gameUser } = ctx.gameSession;
      const result = await movePlayer({
        gameId: ctx.gameSession.id,
        gameUserId: gameUser.id,
        targetGameTeamId: input.gameTeamId,
        actor: { kind: "player", gameUserId: gameUser.id },
      });
      if (result.isErr()) throw toTRPCError(result.error);
      if (result.value.changed) {
        await emitUpdatedGameState({ gameId: ctx.gameSession.id });
      }
      return {
        id: gameUser.id,
        name: gameUser.name,
        index: gameUser.index,
        gameId: gameUser.gameId,
        gameTeamId: input.gameTeamId,
        userId: gameUser.userId,
      };
    }),
  /**
   * Saves this guest player to the signed-in account, so signing in on
   * another device gets back to the same player.
   */
  linkAccount: protectedGameUserProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session?.user?.id;
    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Sign in first to save your player to an account.",
      });
    }
    const result = await linkPlayerToAccount({
      gameId: ctx.gameSession.id,
      gameUserId: ctx.gameSession.gameUser.id,
      userId,
    });
    if (result.isErr()) throw toTRPCError(result.error);
    return result.value;
  }),
  buzzIn: protectedGameUserProcedure
    .input(
      z
        .object({
          requestId: z
            .string()
            .min(8)
            .max(64)
            .regex(/^[A-Za-z0-9_-]+$/),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const { gameUser } = ctx.gameSession;

      const result = await buzzIn({
        gameId: gameUser.gameId,
        gameUserId: gameUser.id,
        requestId: input?.requestId,
      });
      if (result.isErr()) {
        throw toTRPCError(result.error);
      }

      if (!result.value.replayed) {
        await emitUpdatedGameState({ gameId: gameUser.gameId });
      }
      return result.value;
    }),
});
