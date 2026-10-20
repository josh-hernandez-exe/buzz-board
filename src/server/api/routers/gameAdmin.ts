import { randomUUID } from "node:crypto";

import { GameFormat, TeamAssignment } from "@prisma/client";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import {
  createTRPCRouter,
  protectedGameAdminProcedure,
  protectedGameStaffProcedure,
  staffProcedure,
} from "@/server/api/trpc";
import {
  createStaffInvite,
  listStaff,
  removeStaff,
  revokeInvite,
  setStaffRole,
} from "@/server/staff/staffService";
import { INVITABLE_ROLES } from "@/utils/capabilities";

import { toTRPCError, type ServiceError } from "@/server/api/errors";
import {
  runScoreCommand,
  type ScoreCommand,
} from "@/server/scores/scoreService";
import { logger } from "@/logger";
import {
  deleteGame,
  duplicateGame,
  finishGame,
  reopenGame,
  setJoiningOpen,
  setTeamAssignment,
} from "@/server/games/gameService";

import { emitUpdatedGameState } from "@/server/utils/events";
import {
  openBuzzer,
  pauseBuzzer,
  resetBuzzer,
} from "@/server/buzzer/buzzerService";
import { type Result } from "neverthrow";

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
    throw toTRPCError(result.error);
  }
  await publishAfterCommit(ctx.gameSession.id);
  return result.value;
}

/** Runs a state change, maps its error, and publishes if anything changed. */
async function gameControl(
  gameId: string,
  action: (
    gameId: string,
  ) => Promise<Result<{ changed: boolean }, ServiceError>>,
) {
  const result = await action(gameId);
  if (result.isErr()) {
    throw toTRPCError(result.error);
  }
  if (result.value.changed) {
    await publishAfterCommit(gameId);
  }
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
  startBuzzer: protectedGameAdminProcedure.mutation(async ({ ctx }) =>
    gameControl(ctx.gameSession.id, openBuzzer),
  ),
  pauseBuzzer: protectedGameAdminProcedure.mutation(async ({ ctx }) =>
    gameControl(ctx.gameSession.id, pauseBuzzer),
  ),
  resetBuzzer: protectedGameAdminProcedure.mutation(async ({ ctx }) =>
    gameControl(ctx.gameSession.id, resetBuzzer),
  ),
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
  movePlayerToTeam: staffProcedure("moveRoster")
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
  finishGame: protectedGameAdminProcedure.mutation(async ({ ctx }) =>
    gameControl(ctx.gameSession.id, finishGame),
  ),
  reopenGame: protectedGameAdminProcedure.mutation(async ({ ctx }) =>
    gameControl(ctx.gameSession.id, (gameId) => reopenGame(gameId)),
  ),
  setJoiningOpen: protectedGameAdminProcedure
    .input(z.object({ open: z.boolean() }))
    .mutation(async ({ ctx, input }) =>
      gameControl(ctx.gameSession.id, (gameId) =>
        setJoiningOpen(gameId, input.open),
      ),
    ),
  setTeamAssignment: protectedGameAdminProcedure
    .input(z.object({ teamAssignment: z.nativeEnum(TeamAssignment) }))
    .mutation(async ({ ctx, input }) =>
      gameControl(ctx.gameSession.id, (gameId) =>
        setTeamAssignment(gameId, input.teamAssignment),
      ),
    ),
  duplicateGame: staffProcedure("duplicateGame")
    .input(z.object({ requestId: requestIdSchema }).optional())
    .mutation(async ({ ctx, input }) => {
      const result = await duplicateGame({
        gameId: ctx.gameSession.id,
        ownerId: ctx.session.user.id,
        requestId: input?.requestId,
      });
      if (result.isErr()) throw toTRPCError(result.error);
      return { gameId: result.value.game.id, replayed: result.value.replayed };
    }),
  deleteGame: staffProcedure("deleteGame")
    .input(z.object({ confirmName: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteGame({
        gameId: ctx.gameSession.id,
        actorUserId: ctx.session.user.id,
        confirmName: input.confirmName,
      });
      if (result.isErr()) throw toTRPCError(result.error);
      await publishAfterCommit(ctx.gameSession.id);
      return result.value;
    }),
  /** Helpers: co-hosts and moderators. The owner can never be changed here. */
  staff: createTRPCRouter({
    list: protectedGameStaffProcedure.query(async ({ ctx }) => {
      const staff = await listStaff(ctx.gameSession.id);
      return {
        ...staff,
        myRole: ctx.staffRole,
        myUserId: ctx.session.user.id,
      };
    }),
    createInvite: staffProcedure("manageHelpers")
      .input(z.object({ role: z.enum(INVITABLE_ROLES) }))
      .mutation(async ({ ctx, input }) => {
        const { token, invite } = await createStaffInvite({
          gameId: ctx.gameSession.id,
          issuedById: ctx.session.user.id,
          role: input.role,
        });
        await publishAfterCommit(ctx.gameSession.id);
        // The token is only returned here, once; only its hash is stored.
        return {
          path: `/invite/${token}`,
          inviteId: invite.id,
          expiresAt: invite.expiresAt,
        };
      }),
    revokeInvite: staffProcedure("manageHelpers")
      .input(z.object({ inviteId: z.string() }))
      .mutation(async ({ ctx, input }) =>
        gameControl(ctx.gameSession.id, (gameId) =>
          revokeInvite({ gameId, inviteId: input.inviteId }),
        ),
      ),
    setRole: staffProcedure("manageHelpers")
      .input(
        z.object({ gameAdminId: z.string(), role: z.enum(INVITABLE_ROLES) }),
      )
      .mutation(async ({ ctx, input }) =>
        gameControl(ctx.gameSession.id, (gameId) =>
          setStaffRole({ gameId, ...input }),
        ),
      ),
    remove: staffProcedure("manageHelpers")
      .input(z.object({ gameAdminId: z.string() }))
      .mutation(async ({ ctx, input }) =>
        gameControl(ctx.gameSession.id, (gameId) =>
          removeStaff({ gameId, gameAdminId: input.gameAdminId }),
        ),
      ),
  }),
});
