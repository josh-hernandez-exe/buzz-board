import { GameFormat, BuzzerState, Prisma } from "@prisma/client";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedGameAdminProcedure,
} from "@/server/api/trpc";

import { checkTeamsAndGetCurrentScores } from "@/server/db/common";

import { emitUpdatedGameState } from "@/utils/events";

import { getPrivateGameState } from "@/server/db/common";
import { gameEventEmitter } from "@/utils/events";

import { logger } from "@/utils/logger";

export const gameAdminRouter = createTRPCRouter({
  currentGameState: protectedGameAdminProcedure.query(async ({ ctx }) => {
    const { id: gameId } = ctx.gameSession;

    const result = await getPrivateGameState({ gameId });
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  }),
  gameState: protectedGameAdminProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    const { id: gameId } = ctx.gameSession;

    const result = await getPrivateGameState({ gameId });
    if (result.isErr()) {
      throw result.error;
    }

    yield result.value;

    for await (const [eventGameId, gameState] of gameEventEmitter.toIterable(
      "privateGameStateUpdate",
      { signal },
    )) {
      if (eventGameId === gameId) {
        yield gameState;
      }
    }
  }),
  addTeam: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { id: gameId, gameAdmin, format: gameFormat } = ctx.gameSession;

    if (gameFormat === GameFormat.single) {
      throw new Error("Game format does not support teams");
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
  }),
  removeTeam: protectedGameAdminProcedure
    .input(z.object({ gameTeamId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id: gameId, gameAdmin, format: gameFormat } = ctx.gameSession;
      const { gameTeamId } = input;
      if (gameFormat === GameFormat.single) {
        throw new Error("Game format does not support teams");
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
        throw new Error("Game team not found");
      }
      if (gameTeam.gameId !== gameId) {
        throw new Error("Game team not found in this game");
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
    const { gameAdmin, ...game } = ctx.gameSession;

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

    await emitUpdatedGameState({ gameId: game.id });
  }),
  pauseBuzzer: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { gameAdmin, ...game } = ctx.gameSession;

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

    await emitUpdatedGameState({ gameId: game.id });
  }),
  resetBuzzer: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { gameAdmin, ...game } = ctx.gameSession;

    await ctx.db.$transaction([
      ctx.db.gameTeam.updateMany({
        where: {
          gameId: game.id,
        },
        data: {
          buzzerState: BuzzerState.avilalble,
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

    await emitUpdatedGameState({ gameId: game.id });
  }),
  addScore: protectedGameAdminProcedure
    .input(z.record(z.string(), z.number()))
    .mutation(async ({ ctx, input }) => {
      const { gameAdmin, ...game } = ctx.gameSession;

      const result = await checkTeamsAndGetCurrentScores({
        gameId: game.id,
        gameTeamIds: Object.keys(input),
      });

      if (result.isErr()) {
        throw result.error;
      }

      const { scoreboard, currentScores } = result.value;
      const oldScoreboardState = scoreboard?.currentState;

      Object.entries(input).forEach(([gameTeamId, score]) => {
        if (currentScores[gameTeamId] === undefined) {
          currentScores[gameTeamId] = 0;
        }
        currentScores[gameTeamId] += score;
      });

      const scoreboardState = await ctx.db.$transaction(async (tx) => {
        const newScoreboardState = await tx.scoreboardState.create({
          data: {
            gameId: game.id,
            scoreboardId: scoreboard?.id!,
            state: currentScores,
          },
        });

        await tx.scoreboard.update({
          where: {
            id: scoreboard?.id!,
          },
          data: {
            pastStateIds: [
              ...(scoreboard?.pastStateIds as string[]),
              oldScoreboardState?.id!,
            ],
            currentStateId: newScoreboardState.id,
            futureStateIds: [],
          },
        });

        return newScoreboardState;
      });

      await emitUpdatedGameState({ gameId: game.id });

      return scoreboardState;
    }),
  setScore: protectedGameAdminProcedure
    .input(z.record(z.string(), z.number()))
    .mutation(async ({ ctx, input }) => {
      const { gameAdmin, ...game } = ctx.gameSession;

      const result = await checkTeamsAndGetCurrentScores({
        gameId: game.id,
        gameTeamIds: Object.keys(input),
      });

      if (result.isErr()) {
        throw result.error;
      }

      const { scoreboard, currentScores } = result.value;
      const oldScoreboardState = scoreboard?.currentState;

      Object.entries(input).forEach(([gameTeamId, score]) => {
        if (currentScores[gameTeamId] === undefined) {
          currentScores[gameTeamId] = 0;
        }
        currentScores[gameTeamId] = score;
      });

      const scoreboardState = await ctx.db.$transaction(async (tx) => {
        const newScoreboardState = await tx.scoreboardState.create({
          data: {
            gameId: game.id,
            scoreboardId: scoreboard?.id!,
            state: currentScores,
          },
        });

        await tx.scoreboard.update({
          where: {
            id: scoreboard?.id!,
          },
          data: {
            pastStateIds: [
              ...(scoreboard?.pastStateIds as string[]),
              scoreboard?.currentState?.id!,
            ],
            currentStateId: newScoreboardState.id,
            futureStateIds: [],
          },
        });

        return newScoreboardState;
      });

      await emitUpdatedGameState({ gameId: game.id });

      return scoreboardState;
    }),
  undoScore: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { gameAdmin, ...game } = ctx.gameSession;

    const scoreboard = await ctx.db.scoreboard.findUnique({
      where: {
        gameId: game.id,
      },
      include: {
        currentState: true,
      },
    });

    if (!scoreboard) {
      throw new Error("Scoreboard not found");
    }

    const oldPastStateIds = scoreboard?.pastStateIds as string[];
    const oldFutureStateIds = scoreboard?.futureStateIds as string[];
    if (oldPastStateIds.length === 0) {
      throw new Error("No past states to undo");
    }

    const lastStateId = oldPastStateIds.at(-1);

    await ctx.db.scoreboard.update({
      where: {
        id: scoreboard.id,
      },
      data: {
        pastStateIds: [...oldPastStateIds.slice(0, -1)],
        currentStateId: lastStateId,
        futureStateIds: [scoreboard?.currentState?.id!, ...oldFutureStateIds],
      },
    });

    await emitUpdatedGameState({ gameId: game.id });
  }),
  redoScore: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { gameAdmin, ...game } = ctx.gameSession;

    const scoreboard = await ctx.db.scoreboard.findUnique({
      where: {
        gameId: game.id,
      },
      include: {
        currentState: true,
      },
    });

    if (!scoreboard) {
      throw new Error("Scoreboard not found");
    }

    const oldPastStateIds = scoreboard?.pastStateIds as string[];
    const oldFutureStateIds = scoreboard?.futureStateIds as string[];
    if (oldFutureStateIds.length === 0) {
      throw new Error("No past states to redo");
    }

    const lastStateId = oldFutureStateIds.at(-1);

    await ctx.db.scoreboard.update({
      where: {
        id: scoreboard.id,
      },
      data: {
        pastStateIds: [...oldPastStateIds, scoreboard?.currentState?.id!],
        currentStateId: lastStateId,
        futureStateIds: [...oldFutureStateIds.slice(1)],
      },
    });

    await emitUpdatedGameState({ gameId: game.id });
  }),
});
