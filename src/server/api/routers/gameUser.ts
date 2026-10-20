import {
  GameFormat,
  GameStatus,
  TeamAssignment,
  type Prisma,
} from "@prisma/client";
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
import { nameErrorMessage, normalizeName } from "@/utils/displayName";
import type {
  GameUserWithRelations,
  GameTeamWithRelations,
  GameSettings,
  GameUserBasicInfo,
  GameTeamBasicInfo,
} from "@/types";

function assertNotFinished(status: GameStatus) {
  if (status === GameStatus.finished) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This game has finished, so names and teams can't be changed.",
    });
  }
}

function parseName(raw: string, what: string): string {
  const result = normalizeName(raw);
  if (result.isErr()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: nameErrorMessage(result.error, what),
    });
  }
  return result.value;
}

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
      }),
    )
    .mutation(async ({ ctx, input: rawInput }) => {
      const { gameUser } = ctx.gameSession;
      assertNotFinished(ctx.gameSession.status);
      const input = { name: parseName(rawInput.name, "Nickname") };
      const result: GameUserBasicInfo = {
        id: gameUser.id,
        name: gameUser.name,
        index: gameUser.index,
        gameId: gameUser.gameId,
        gameTeamId: gameUser.gameTeamId,
        userId: gameUser.userId,
      };

      if (gameUser.name === input.name) {
        // name is already the same and do not do anything
        return result;
      }

      const nameChangePromises: Prisma.PrismaPromise<unknown>[] = [
        ctx.db.gameUser.update({
          where: {
            id: gameUser.id,
          },
          data: {
            name: input.name,
          },
        }),
      ];

      if (
        gameUser.gameTeamId &&
        ctx.gameSession.format === GameFormat.individual
      ) {
        nameChangePromises.push(
          ctx.db.gameTeam.update({
            where: {
              id: gameUser.gameTeamId,
            },
            data: {
              name: input.name,
            },
          }),
        );
      }

      await ctx.db.$transaction(nameChangePromises);

      await emitUpdatedGameState({ gameId: ctx.gameSession.id });

      return {
        ...result,
        name: input.name,
      };
    }),
  changeTeamName: protectedGameUserProcedure
    .input(
      z.object({
        name: z.string().max(400),
      }),
    )
    .mutation(async ({ ctx, input: rawInput }) => {
      const { gameUser } = ctx.gameSession;
      assertNotFinished(ctx.gameSession.status);
      const input = { name: parseName(rawInput.name, "Team name") };

      if (!gameUser.gameTeamId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "GameUser is not on a team.",
        });
      }

      const gameTeam = await ctx.db.gameTeam.findUnique({
        where: {
          id: gameUser.gameTeamId,
        },
      });

      if (!gameTeam) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No team found.",
        });
      }

      const result: GameTeamBasicInfo = {
        id: gameTeam.id,
        name: gameTeam.name,
        index: gameTeam.index,
        gameId: gameTeam.gameId,
      };

      if (gameTeam.name === input.name) {
        // name is already the same and do not do anything
        return result;
      }

      const nameChangePromises: Prisma.PrismaPromise<unknown>[] = [
        ctx.db.gameTeam.update({
          where: {
            id: gameUser.gameTeamId,
          },
          data: {
            name: input.name,
          },
        }),
      ];

      if (ctx.gameSession.format === GameFormat.individual) {
        nameChangePromises.push(
          ctx.db.gameUser.update({
            where: {
              id: gameUser.id,
            },
            data: {
              name: input.name,
            },
          }),
        );
      }

      await ctx.db.$transaction(nameChangePromises);

      await emitUpdatedGameState({ gameId: ctx.gameSession.id });

      return {
        ...result,
        name: input.name,
      };
    }),
  changeTeams: protectedGameUserProcedure
    .input(
      z.object({
        gameTeamId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const gameUser = ctx.gameSession.gameUser;
      const settings = ctx.gameSession.settings as GameSettings;

      if (ctx.gameSession.format === GameFormat.individual) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game format does not support teams",
        });
      }

      if (gameUser.gameTeamId === input.gameTeamId) {
        // same team do nothing
        return {
          id: gameUser.id,
          name: gameUser.name,
          index: gameUser.index,
          gameId: gameUser.gameId,
          gameTeamId: gameUser.gameTeamId,
          userId: gameUser.userId,
        };
      }

      assertNotFinished(ctx.gameSession.status);
      if (ctx.gameSession.teamAssignment === TeamAssignment.staff) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your host assigns teams in this game.",
        });
      }

      if (settings?.freezeTeams) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Team switching is currently disabled",
        });
      }

      const gameTeam = await ctx.db.gameTeam.findUnique({
        where: {
          id: input.gameTeamId,
        },
      });

      if (!gameTeam) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Game team not found",
        });
      }
      if (gameTeam.gameId !== gameUser.gameId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game team is not part of this game.",
        });
      }

      const gameUserUpdated = await ctx.db.gameUser.update({
        where: {
          id: gameUser.id,
        },
        data: {
          gameTeamId: input.gameTeamId,
        },
      });

      await emitUpdatedGameState({
        gameId: gameUser.gameId,
      });

      return {
        id: gameUserUpdated.id,
        name: gameUserUpdated.name,
        index: gameUserUpdated.index,
        gameId: gameUserUpdated.gameId,
        gameTeamId: gameUserUpdated.gameTeamId,
        userId: gameUserUpdated.userId,
      };
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
