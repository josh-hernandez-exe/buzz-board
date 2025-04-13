import { GameFormat, BuzzerState } from "@prisma/client";
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
});
