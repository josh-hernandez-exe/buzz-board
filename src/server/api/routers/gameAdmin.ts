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
});
