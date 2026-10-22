import { randomUUID } from "node:crypto";

import { BuzzerMode, GameFormat, TeamAssignment } from "@prisma/client";
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
import {
  movePlayer,
  removePlayer,
  renamePlayer,
  renameTeam,
} from "@/server/roster/rosterService";
import { createRecoveryLink } from "@/server/identity/identityService";

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
  buzzerHistory,
  undoBuzzer,
  redoBuzzer,
  judgeQueueEntry,
  setBuzzerMode,
  releaseTeamsFromQueue,
} from "@/server/buzzer/buzzerService";
import { withGameLock } from "@/server/db/gameTransaction";
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
      // Read and change the team under the game lock, so two removals (or
      // a buzz) can't interleave: indexes are shifted from a fresh read.
      const removed = await withGameLock(gameId, async (tx) => {
        const gameTeam = await tx.gameTeam.findFirst({
          where: { id: gameTeamId, gameId },
          select: { id: true, index: true },
        });
        if (!gameTeam) return false;
        await releaseTeamsFromQueue(tx, gameId, [gameTeam.id]);
        await tx.gameUser.updateMany({
          where: { gameTeamId: gameTeam.id },
          data: { gameTeamId: null },
        });
        await tx.gameTeam.delete({ where: { id: gameTeam.id } });
        // One at a time, lowest first: (gameId, index) is unique and checked
        // row by row, so a single "index - 1" update could collide depending
        // on the order Postgres visits the rows.
        const later = await tx.gameTeam.findMany({
          where: { gameId, index: { gt: gameTeam.index } },
          orderBy: { index: "asc" },
          select: { id: true, index: true },
        });
        for (const team of later) {
          await tx.gameTeam.update({
            where: { id: team.id },
            data: { index: team.index - 1 },
          });
        }
        return true;
      });
      if (removed.isErr()) throw toTRPCError(removed.error);
      if (!removed.value) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Game team not found",
        });
      }

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
  /** Queue mode, buzzer history (undo/redo) and mode switching. */
  buzzer: createTRPCRouter({
    history: protectedGameAdminProcedure.query(({ ctx }) =>
      buzzerHistory(ctx.gameSession.id),
    ),
    undo: protectedGameAdminProcedure.mutation(({ ctx }) =>
      gameControl(ctx.gameSession.id, undoBuzzer),
    ),
    redo: protectedGameAdminProcedure.mutation(({ ctx }) =>
      gameControl(ctx.gameSession.id, redoBuzzer),
    ),
    judge: protectedGameAdminProcedure
      .input(
        z.object({
          entryId: z.string().min(1).max(64),
          verdict: z.enum(["correct", "wrong", "skip"]),
        }),
      )
      .mutation(({ ctx, input }) =>
        gameControl(ctx.gameSession.id, (gameId) =>
          judgeQueueEntry(gameId, input.entryId, input.verdict),
        ),
      ),
    setMode: protectedGameAdminProcedure
      .input(z.object({ mode: z.enum([BuzzerMode.first, BuzzerMode.queue]) }))
      .mutation(({ ctx, input }) =>
        gameControl(ctx.gameSession.id, (gameId) =>
          setBuzzerMode(gameId, input.mode),
        ),
      ),
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
  movePlayerToTeam: staffProcedure("moveRoster")
    .input(
      z.object({
        gameUserId: z.string(),
        /** `null` leaves the player without a team. */
        targetGameTeamId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      gameControl(ctx.gameSession.id, (gameId) =>
        movePlayer({ gameId, ...input, actor: { kind: "staff" } }),
      ),
    ),
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
    .input(
      z.object({
        confirmName: z.string().max(200),
        /** End a game still in play and delete it, in one step. */
        finishFirst: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await deleteGame({
        gameId: ctx.gameSession.id,
        actorUserId: ctx.session.user.id,
        confirmName: input.confirmName,
        finishFirst: input.finishFirst,
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
  /** Players: names, rename locks, removal and guest recovery. */
  roster: createTRPCRouter({
    list: protectedGameStaffProcedure.query(async ({ ctx }) => {
      const players = await ctx.db.gameUser.findMany({
        where: { gameId: ctx.gameSession.id, removedAt: null },
        orderBy: { index: "asc" },
        select: {
          id: true,
          name: true,
          index: true,
          gameTeamId: true,
          allowSelfRename: true,
          nameVersion: true,
          userId: true,
        },
      });
      const removedCount = await ctx.db.gameUser.count({
        where: { gameId: ctx.gameSession.id, removedAt: { not: null } },
      });
      return {
        players: players.map(({ userId, ...player }) => ({
          ...player,
          /** Saved to an account: they sign in to return, no recovery link. */
          isLinked: userId !== null,
        })),
        removedCount,
      };
    }),
    renamePlayer: staffProcedure("moderateNames")
      .input(
        z.object({
          gameUserId: z.string(),
          name: z.string().max(400).optional(),
          allowSelfRename: z.boolean().optional(),
          expectedNameVersion: z.number().int().nonnegative().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        gameControl(ctx.gameSession.id, (gameId) =>
          renamePlayer({ gameId, ...input, actor: { kind: "staff" } }),
        ),
      ),
    renameTeam: staffProcedure("moderateNames")
      .input(
        z.object({
          gameTeamId: z.string(),
          name: z.string().max(400).optional(),
          allowMemberRename: z.boolean().optional(),
          expectedNameVersion: z.number().int().nonnegative().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        gameControl(ctx.gameSession.id, (gameId) =>
          renameTeam({ gameId, ...input, actor: { kind: "staff" } }),
        ),
      ),
    removePlayer: staffProcedure("removePlayers")
      .input(z.object({ gameUserId: z.string() }))
      .mutation(async ({ ctx, input }) =>
        gameControl(ctx.gameSession.id, (gameId) =>
          removePlayer({ gameId, gameUserId: input.gameUserId }),
        ),
      ),
    createRecoveryLink: staffProcedure("recoverGuests")
      .input(z.object({ gameUserId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const result = await createRecoveryLink({
          gameId: ctx.gameSession.id,
          gameUserId: input.gameUserId,
          issuedById: ctx.session.user.id,
        });
        if (result.isErr()) throw toTRPCError(result.error);
        // The token is only returned here, once; only its hash is stored.
        return {
          path: `/recover/${result.value.token}`,
          expiresAt: result.value.expiresAt,
          nickname: result.value.nickname,
        };
      }),
  }),
});
