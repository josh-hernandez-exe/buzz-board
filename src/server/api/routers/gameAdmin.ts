import { GameFormat, BuzzerState, Prisma } from "@prisma/client";
import { z } from "zod";

import { logger } from "@/utils/logger";

import {
  createTRPCRouter,
  protectedGameAdminProcedure,
} from "@/server/api/trpc";

export const gameAdminRouter = createTRPCRouter({
  getAllInfo: protectedGameAdminProcedure.query(async ({ ctx }) => {
    const { id: gameId, gameAdmin, format: gameFormat } = ctx.gameSession;

    const game = await ctx.db.game.findUnique({
      where: {
        id: gameId,
      },
      include: {
        gameUsers: true,
        gameTeams: true,
        gameAdmins: true,
        scoreboard: true,
        scoreboardStates: true,
      },
    });

    return game;
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
    const curTeamCount = aggResult._max.index || 0;
    const newTeamIndex = curTeamCount + 1;

    const newTeam = await ctx.db.gameTeam.create({
      data: {
        index: newTeamIndex,
        name: `Team ${newTeamIndex}`,
        gameId,
      },
    });
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
    }),
  startBuzzer: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { gameAdmin, ...game } = ctx.gameSession;

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
  }),
  pauseBuzzer: protectedGameAdminProcedure.mutation(async ({ ctx }) => {
    const { gameAdmin, ...game } = ctx.gameSession;

    await ctx.db.game.update({
      where: {
        id: game.id,
      },
      data: {
        isBuzzerListening: false,
      },
    });
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
  }),
  addScore: protectedGameAdminProcedure
    .input(z.record(z.string(), z.number()))
    .mutation(async ({ ctx, input }) => {
      const { gameAdmin, ...game } = ctx.gameSession;

      const gameTeams = await ctx.db.gameTeam.findMany({
        where: {
          gameId: game.id,
          id: {
            in: Object.keys(input),
          },
        },
      });

      if (gameTeams.length !== Object.keys(input).length) {
        throw new Error("Game teams not found");
      }

      const scoreboard = await ctx.db.scoreboard.findUnique({
        where: {
          gameId: game.id,
        },
        include: {
          currentState: true,
        },
      });

      const oldScoreboardState = scoreboard?.currentState;

      const currentScores: { [key: string]: number } =
        (oldScoreboardState?.state as { [key: string]: number }) || {};

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

      return scoreboardState;
    }),
  setScore: protectedGameAdminProcedure
    .input(z.record(z.string(), z.number()))
    .mutation(async ({ ctx, input }) => {
      const { gameAdmin, ...game } = ctx.gameSession;

      const gameTeams = await ctx.db.gameTeam.findMany({
        where: {
          gameId: game.id,
          id: {
            in: Object.keys(input),
          },
        },
      });

      if (gameTeams.length !== Object.keys(input).length) {
        throw new Error("Game teams not found");
      }

      const scoreboard = await ctx.db.scoreboard.findUnique({
        where: {
          gameId: game.id,
        },
        include: {
          currentState: true,
        },
      });

      const oldScoreboardState = scoreboard?.currentState;

      const currentScores: { [key: string]: number } =
        (oldScoreboardState?.state as { [key: string]: number }) || {};

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
  }),
});
