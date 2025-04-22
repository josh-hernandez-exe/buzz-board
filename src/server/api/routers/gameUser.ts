import { GameFormat, BuzzerState } from "@prisma/client";
import { z } from "zod";

import { logger } from "@/logger";

import {
  createTRPCRouter,
  protectedGameUserProcedure,
} from "@/server/api/trpc";

import { emitUpdatedGameState, emitWhoBuzzedIn } from "@/server/utils/events";
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
      throw new Error("Game user not found");
    }
    return gameUser;
  }),
  getSelfTeamInfo: protectedGameUserProcedure.query(async ({ ctx }) => {
    const { gameUser } = ctx.gameSession;

    if (!gameUser.gameTeamId) {
      throw new Error("GameUser is not on a team.");
    }
    if (ctx.gameSession.format !== GameFormat.team) {
      throw new Error("Game format does not support teams");
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
      throw new Error("Game team not found");
    }

    return gameTeam;
  }),
  changeName: protectedGameUserProcedure
    .input(
      z.object({
        name: z.string().min(1).max(32),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { gameUser } = ctx.gameSession;

      if (gameUser.name === input.name) {
        // name is already the same and do not do anything
        return;
      }

      const nameChangePromises: any = [
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
    }),
  changeTeamName: protectedGameUserProcedure
    .input(
      z.object({
        name: z.string().min(1).max(32),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { gameUser } = ctx.gameSession;

      if (!gameUser.gameTeamId) {
        throw new Error("GameUser is not on a team.");
      }

      const gameTeam = await ctx.db.gameTeam.findUnique({
        where: {
          id: gameUser.gameTeamId,
        },
      });

      if (gameUser.name === input.name) {
        // name is already the same and do not do anything
        return;
      }

      const nameChangePromises: any = [
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

      return gameTeam;
    }),
  changeTeams: protectedGameUserProcedure
    .input(
      z.object({
        gameTeamId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { gameUser } = ctx.gameSession;

      if (ctx.gameSession.format === GameFormat.individual) {
        throw new Error("Game format does not support teams");
      }

      if (gameUser.gameTeamId === input.gameTeamId) {
        // same team do nothing
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

      await emitUpdatedGameState({
        gameId: gameUser.gameId,
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
      select: {
        id: true,
        buzzerState: true,
      },
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

    await ctx.db.$transaction(async (trx) => {
      // Note1: to act as a psuedo mutex we only write with the expected buzzer state
      //        only if both updates are successful will this take.
      //        furthermore, if someone else made the query at the exact same time
      //        the where clause will hopefully be enough to deal with that.
      // Note2: This end point is likely getting hit with high bursts.
      //        So we select to reduce the amount of data grabbed for it to be successful.
      const [updatedTeam, updatedGame] = await Promise.all([
        trx.gameTeam.update({
          select: {
            id: true,
          },
          where: {
            id: gameTeamId,
            buzzerState: BuzzerState.avilalble,
          },
          data: {
            buzzerState: BuzzerState.selected,
          },
        }),
        trx.game.update({
          select: {
            id: true,
          },
          where: {
            id: gameUser.gameId,
            isBuzzerListening: true,
          },
          data: {
            isBuzzerListening: false,
          },
        }),
      ]);
      if (!updatedTeam || !updatedGame) {
        // throw and rollback
        throw new Error("Invalid buzzer state.");
      }
    });

    // only emit above query is successful.
    await Promise.all([
      emitWhoBuzzedIn({ gameUserId: gameUser.id }),
      emitUpdatedGameState({
        gameId: gameUser.gameId,
      }),
    ]);
  }),
});
