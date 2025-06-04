import { GameFormat, BuzzerState } from "@prisma/client";
import { z } from "zod";

import {
  createTRPCRouter,
  protectedGameAdminProcedure,
} from "@/server/api/trpc";

import { checkTeamsAndGetCurrentScores } from "@/server/db/common";

import {
  emitUpdatedGameState,
  updateBuzzerListeningState,
} from "@/server/utils/events";

import type { GameSettings } from "@/types";

export const gameAdminRouter = createTRPCRouter({
  addTeam: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const {
      id: gameId,
      gameAdmin: _gameAdmin,
      format: gameFormat,
    } = ctx.gameSession;

    if (gameFormat === GameFormat.individual) {
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

    await Promise.all([
      emitUpdatedGameState({ gameId: game.id }),
      updateBuzzerListeningState({ gameId: game.id }),
    ]);
  }),
  addScore: protectedGameAdminProcedure
    .input(z.record(z.string(), z.number()))
    .mutation(async ({ ctx, input }) => {
      const { gameAdmin: _gameAdmin, ...game } = ctx.gameSession;

      const result = await checkTeamsAndGetCurrentScores({
        gameId: game.id,
        gameTeamIds: Object.keys(input),
      });

      if (result.isErr()) {
        throw result.error;
      }

      const { scoreboard, currentScores } = result.value;

      Object.entries(input).forEach(([gameTeamId, score]) => {
        currentScores[gameTeamId] ??= 0;
        currentScores[gameTeamId] += score;
      });

      const scoreboardState = await ctx.db.$transaction(async (tx) => {
        const newScoreboardState = await tx.scoreboardState.create({
          data: {
            gameId: game.id,
            scoreboardId: scoreboard?.id,
            state: currentScores,
          },
        });

        const newPastStateIds = scoreboard?.pastStateIds as string[];
        if (typeof scoreboard?.currentState?.id === "string") {
          newPastStateIds.push(scoreboard?.currentState.id);
        }

        await tx.scoreboard.update({
          where: {
            id: scoreboard?.id,
          },
          data: {
            pastStateIds: newPastStateIds,
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
      const { gameAdmin: _gameAdmin, ...game } = ctx.gameSession;

      const result = await checkTeamsAndGetCurrentScores({
        gameId: game.id,
        gameTeamIds: Object.keys(input),
      });

      if (result.isErr()) {
        throw result.error;
      }

      const { scoreboard, currentScores } = result.value;

      if (!scoreboard) {
        throw new Error("Scoreboard not found");
      }

      Object.entries(input).forEach(([gameTeamId, score]) => {
        currentScores[gameTeamId] ??= 0;
        currentScores[gameTeamId] = score;
      });

      const scoreboardState = await ctx.db.$transaction(async (tx) => {
        const newScoreboardState = await tx.scoreboardState.create({
          data: {
            gameId: game.id,
            scoreboardId: scoreboard?.id,
            state: currentScores,
          },
        });

        const newPastStateIds = scoreboard?.pastStateIds as string[];
        if (typeof scoreboard?.currentState?.id === "string") {
          newPastStateIds.push(scoreboard?.currentState.id);
        }

        await tx.scoreboard.update({
          where: {
            id: scoreboard?.id,
          },
          data: {
            pastStateIds: newPastStateIds,
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
    const { gameAdmin: _gameAdmin, ...game } = ctx.gameSession;

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

    let newFutureStateIds = [...oldFutureStateIds];
    if (typeof scoreboard?.currentState?.id === "string") {
      newFutureStateIds = [scoreboard?.currentState.id, ...oldFutureStateIds];
    }

    await ctx.db.scoreboard.update({
      where: {
        id: scoreboard.id,
      },
      data: {
        pastStateIds: [...oldPastStateIds.slice(0, -1)],
        currentStateId: lastStateId,
        futureStateIds: newFutureStateIds,
      },
    });

    await emitUpdatedGameState({ gameId: game.id });
  }),
  redoScore: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { gameAdmin: _gameAdmin, ...game } = ctx.gameSession;

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

    const newPastStateIds = [...oldPastStateIds];
    if (typeof scoreboard?.currentState?.id === "string") {
      newPastStateIds.push(scoreboard?.currentState.id);
    }

    await ctx.db.scoreboard.update({
      where: {
        id: scoreboard.id,
      },
      data: {
        pastStateIds: newPastStateIds,
        currentStateId: lastStateId,
        futureStateIds: [...oldFutureStateIds.slice(1)],
      },
    });

    await emitUpdatedGameState({ gameId: game.id });
  }),
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
        throw new Error("Player not found in this game.");
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
          throw new Error("Target team not found in this game.");
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
        throw new Error("Game format does not support teams");
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
