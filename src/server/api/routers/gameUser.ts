import { GameFormat, BuzzerState } from "@prisma/client";
import { z } from "zod";

import { logger } from "@/utils/logger";

import {
  createTRPCRouter,
  protectedGameUserProcedure,
} from "@/server/api/trpc";

export const gameUserRouter = createTRPCRouter({
  ping: protectedGameUserProcedure.query(({ ctx }) => {
    const { gameUser } = ctx.gameSession;
    logger.info(`Ping from game user: ${gameUser.id}`);
    return "pong";
  }),
  getSimpleInfo: protectedGameUserProcedure.query(async ({ ctx }) => {
    logger.info(
      `Get simple info from game user: ${ctx.gameSession.gameUser.id}`,
    );

    const result = await ctx.db.gameUser.findUnique({
      where: {
        id: ctx.gameSession.gameUser.id,
      },
      include: {
        game: {
          include: {
            gameTeams: true,
          },
        },
        gameTeam: true,
      },
    });

    if (!result) {
      throw new Error("Game user not found");
    }

    const { game: gameData, ...gameUser } = result;
    const { gameTeams, ...game } = gameData;

    return {
      game,
      gameUser,
      gameTeams,
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

      if (ctx.gameSession.format === GameFormat.single) {
        throw new Error("Game format does not support teams");
      }

      if (gameUser.gameTeamId === input.gameTeamId) {
        return gameUser;
      }

      const gameTeam = await ctx.db.gameTeam.findUnique({
        where: {
          id: input.gameTeamId,
        },
      });

      if (!gameTeam) {
        throw new Error("Game team not found");
      }
      if (gameTeam.gameId !== gameUser.gameId) {
        throw new Error("Game team is not part of this game.");
      }

      const gameUserUpdated = await ctx.db.gameUser.update({
        where: {
          id: gameUser.id,
        },
        data: {
          gameTeamId: input.gameTeamId,
        },
      });

      return gameUserUpdated;
    }),
  buzzIn: protectedGameUserProcedure.mutation(async ({ ctx }) => {
    const { gameUser, isBuzzerListening } = ctx.gameSession;
    const { gameTeamId } = gameUser;

    if (!gameTeamId) {
      throw new Error("Game user is not part of a team");
    }

    if (!isBuzzerListening) {
      throw new Error("Game is not listening for buzzers");
    }

    const gameTeam = await ctx.db.gameTeam.findUnique({
      where: {
        id: gameTeamId,
      },
    });

    if (gameTeam?.buzzerState === BuzzerState.rejected) {
      throw new Error("Game team has already buzzed in.");
    }

    if (gameTeam?.buzzerState === BuzzerState.selected) {
      return;
    }

    await ctx.db.$transaction([
      ctx.db.gameTeam.update({
        where: {
          id: gameTeamId,
        },
        data: {
          buzzerState: BuzzerState.selected,
        },
      }),
      ctx.db.game.update({
        where: {
          id: gameUser.gameId,
        },
        data: {
          isBuzzerListening: false,
        },
      }),
    ]);
  }),
});
