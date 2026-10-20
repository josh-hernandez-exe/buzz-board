import { randomUUID } from "node:crypto";

import { GameFormat, BuzzerState } from "@prisma/client";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import {
  createTRPCRouter,
  protectedGameAdminProcedure,
} from "@/server/api/trpc";

import { gameTransactionErrorToTRPC } from "@/server/api/errors";
import {
  runScoreCommand,
  type ScoreCommand,
  type ScoreCommandError,
} from "@/server/scores/scoreService";
import { logger } from "@/logger";

import {
  emitUpdatedGameState,
  updateBuzzerListeningState,
} from "@/server/utils/events";

import type { GameSettings } from "@/types";

const requestIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

const scoreChangesSchema = z
  .record(z.string(), z.number())
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "Choose at least one team",
  });

/**
 * `{ requestId, changes }`, or the legacy bare `{ [teamId]: amount }` record
 * that clients from before PR03 send (no retry deduplication).
 */
const scoreChangeInput = z.union([
  z.object({ requestId: requestIdSchema, changes: scoreChangesSchema }),
  scoreChangesSchema,
]);
const historyInput = z
  .object({ requestId: requestIdSchema })
  .optional()
  .or(z.undefined());

function normalizeScoreChange(input: z.infer<typeof scoreChangeInput>) {
  if ("changes" in input && typeof input.requestId === "string") {
    return {
      requestId: input.requestId,
      changes: input.changes as Record<string, number>,
    };
  }
  return { requestId: undefined, changes: input as Record<string, number> };
}

function scoreErrorToTRPC(error: ScoreCommandError): TRPCError {
  switch (error.kind) {
    case "gameNotFound":
    case "busy":
      return gameTransactionErrorToTRPC(error);
    case "scoreboardNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "Scoreboard not found",
      });
    case "unknownTeams":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "Game teams not found",
      });
    case "noChanges":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose at least one team",
      });
    case "invalidAmount":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `Scores must be whole numbers between -1,000,000 and 1,000,000 per change (got ${error.value}).`,
      });
    case "scoreOutOfRange":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "That change would put a score outside ±1,000,000,000.",
      });
    case "nothingToUndo":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "No past states to undo",
      });
    case "nothingToRedo":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "No past states to redo",
      });
    case "historyCorrupt":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Score history is inconsistent; the change was not applied.",
      });
    case "requestIdReused":
      return new TRPCError({
        code: "CONFLICT",
        message: "This request ID was already used for a different change.",
      });
  }
}

/** Publishes after commit; a failure is logged, never treated as unsaved. */
async function publishAfterCommit(gameId: string) {
  try {
    const result = await emitUpdatedGameState({ gameId });
    if (result.isErr()) {
      logger.warn(`Saved, but could not publish game ${gameId}`, result.error);
    }
  } catch (error) {
    logger.warn(`Saved, but could not publish game ${gameId}`, error);
  }
}

async function scoreCommand(
  ctx: {
    gameSession: { id: string };
    session: { user: { id: string } } | null;
  },
  requestId: string | undefined,
  command: ScoreCommand,
) {
  const result = await runScoreCommand({
    gameId: ctx.gameSession.id,
    actorUserId: ctx.session?.user.id ?? null,
    requestId: requestId ?? `server-${randomUUID()}`,
    command,
  });
  if (result.isErr()) {
    throw scoreErrorToTRPC(result.error);
  }
  await publishAfterCommit(ctx.gameSession.id);
  return result.value;
}

export const gameAdminRouter = createTRPCRouter({
  addTeam: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const {
      id: gameId,
      gameAdmin: _gameAdmin,
      format: gameFormat,
    } = ctx.gameSession;

    if (gameFormat === GameFormat.individual) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Game format does not support teams",
      });
    }

    const aggResult = await ctx.db.gameTeam.aggregate({
      where: { gameId },
      _max: {
        index: true,
      },
    });
    const curTeamCount = aggResult._max.index ?? 0;
    const newTeamIndex = curTeamCount + 1;

    const newTeam = await ctx.db.gameTeam.create({
      data: {
        index: newTeamIndex,
        name: `Team ${newTeamIndex}`,
        gameId,
      },
    });

    await emitUpdatedGameState({ gameId });

    return newTeam;
  }),
  removeTeam: protectedGameAdminProcedure
    .input(z.object({ gameTeamId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const {
        id: gameId,
        gameAdmin: _gameAdmin,
        format: gameFormat,
      } = ctx.gameSession;
      const { gameTeamId } = input;

      if (gameFormat === GameFormat.individual) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game format does not support teams",
        });
      }
      const gameTeam = await ctx.db.gameTeam.findUnique({
        where: {
          id: gameTeamId,
        },
        include: {
          game: true,
          gameUsers: true,
        },
      });
      if (!gameTeam) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Game team not found",
        });
      }
      if (gameTeam.gameId !== gameId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game team not found in this game",
        });
      }

      await ctx.db.$transaction([
        ctx.db.gameUser.updateMany({
          where: {
            gameTeamId: gameTeam.id,
          },
          data: {
            gameTeamId: null,
          },
        }),
        ctx.db.gameTeam.delete({
          where: {
            id: gameTeam.id,
          },
        }),
        ctx.db.gameTeam.updateMany({
          where: {
            gameId: gameTeam.gameId,
            index: {
              gt: gameTeam.index,
            },
          },
          data: {
            index: {
              decrement: 1,
            },
          },
        }),
      ]);

      await emitUpdatedGameState({ gameId });
    }),
  startBuzzer: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { gameAdmin: _gameAdmin, ...game } = ctx.gameSession;

    if (game.isBuzzerListening) {
      // already listening
      return;
    }

    await ctx.db.$transaction([
      ctx.db.gameTeam.updateMany({
        where: {
          gameId: game.id,
          buzzerState: BuzzerState.selected,
        },
        data: {
          buzzerState: BuzzerState.rejected,
        },
      }),
      ctx.db.game.update({
        where: {
          id: game.id,
        },
        data: {
          isBuzzerListening: true,
        },
      }),
    ]);

    await Promise.all([
      emitUpdatedGameState({ gameId: game.id }),
      updateBuzzerListeningState({ gameId: game.id }),
    ]);
  }),
  pauseBuzzer: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { gameAdmin: _gameAdmin, ...game } = ctx.gameSession;

    if (!game.isBuzzerListening) {
      // already not listening
      return;
    }

    await ctx.db.game.update({
      where: {
        id: game.id,
      },
      data: {
        isBuzzerListening: false,
      },
    });

    await Promise.all([
      emitUpdatedGameState({ gameId: game.id }),
      updateBuzzerListeningState({ gameId: game.id }),
    ]);
  }),
  resetBuzzer: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { gameAdmin: _gameAdmin, ...game } = ctx.gameSession;

    await ctx.db.$transaction([
      ctx.db.gameTeam.updateMany({
        where: {
          gameId: game.id,
        },
        data: {
          buzzerState: BuzzerState.available,
        },
      }),
      ctx.db.game.update({
        where: {
          id: game.id,
        },
        data: {
          isBuzzerListening: false,
        },
      }),
    ]);

    await Promise.all([
      emitUpdatedGameState({ gameId: game.id }),
      updateBuzzerListeningState({ gameId: game.id }),
    ]);
  }),
  addScore: protectedGameAdminProcedure
    .input(scoreChangeInput)
    .mutation(async ({ ctx, input }) => {
      const { requestId, changes } = normalizeScoreChange(input);
      return scoreCommand(ctx, requestId, { kind: "add", changes });
    }),
  setScore: protectedGameAdminProcedure
    .input(scoreChangeInput)
    .mutation(async ({ ctx, input }) => {
      const { requestId, changes } = normalizeScoreChange(input);
      return scoreCommand(ctx, requestId, { kind: "set", changes });
    }),
  undoScore: protectedGameAdminProcedure
    .input(historyInput)
    .mutation(async ({ ctx, input }) =>
      scoreCommand(ctx, input?.requestId, { kind: "undo" }),
    ),
  redoScore: protectedGameAdminProcedure
    .input(historyInput)
    .mutation(async ({ ctx, input }) =>
      scoreCommand(ctx, input?.requestId, { kind: "redo" }),
    ),
  movePlayerToTeam: protectedGameAdminProcedure
    .input(
      z.object({
        gameUserId: z.string(),
        targetGameTeamId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id: gameId } = ctx.gameSession;
      const { gameUserId, targetGameTeamId } = input;

      const gameUser = await ctx.db.gameUser.findUnique({
        where: { id: gameUserId, gameId },
      });

      if (!gameUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Player not found in this game.",
        });
      }

      // If the player is already in the target team (or both are null), no action needed
      if (gameUser.gameTeamId === targetGameTeamId) {
        return gameUser; // Or some other indication of no change
      }

      if (targetGameTeamId) {
        const targetTeam = await ctx.db.gameTeam.findUnique({
          where: { id: targetGameTeamId, gameId },
        });
        if (!targetTeam) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Target team not found in this game.",
          });
        }
      }

      const updatedGameUser = await ctx.db.gameUser.update({
        where: { id: gameUserId },
        data: { gameTeamId: targetGameTeamId },
      });

      await emitUpdatedGameState({ gameId });

      return updatedGameUser;
    }),
  toggleFreezeTeams: protectedGameAdminProcedure
    .input(z.object({ freeze: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { gameAdmin: _gameAdmin, ...game } = ctx.gameSession;
      const currentSettings = (game.settings as GameSettings) ?? {};

      if (game.format === GameFormat.individual) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game format does not support teams",
        });
      }

      if (input.freeze === !!currentSettings.freezeTeams) {
        // no change needed
        return input.freeze;
      }

      const updatedSettings = {
        ...currentSettings,
        freezeTeams: input.freeze,
      };

      await ctx.db.game.update({
        where: {
          id: game.id,
        },
        data: {
          settings: updatedSettings,
        },
      });

      await emitUpdatedGameState({ gameId: game.id });

      return;
    }),
});
