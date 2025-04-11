import { GameFormat } from "@prisma/client";
import { z } from "zod";

import { logger } from "@/utils/logger";

import {
  createTRPCRouter,
  protectedGameAdmintProcedure,
} from "@/server/api/trpc";

export const gameAdminRouter = createTRPCRouter({
  getAllInfo: protectedGameAdmintProcedure.query(async ({ ctx }) => {
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
  addTeam: protectedGameAdmintProcedure.mutation(async ({ ctx }) => {
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
});
