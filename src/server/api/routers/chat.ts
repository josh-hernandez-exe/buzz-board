import { TRPCError } from "@trpc/server";
import { type Result } from "neverthrow";
import { z } from "zod";

import { toTRPCError } from "@/server/api/errors";
import {
  createTRPCRouter,
  protectedGameAdminProcedure,
  publicProcedure,
  staffProcedure,
} from "@/server/api/trpc";
import {
  chatStatus,
  clearHistory,
  listMutes,
  mergedRecent,
  muteActor,
  pinMessage,
  recentMessages,
  removeMessage,
  sendMessage,
  setChannelPolicy,
  setChatEnabled,
  unmuteActor,
} from "@/server/chat/chatService";
import { staffRoleFor } from "@/server/staff/staffService";
import { emitUpdatedGameState } from "@/server/utils/events";
import { CHAT_LIMITS, type ChatActor } from "@/utils/chatRules";

const requestIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const channelKeySchema = z.string().min(1).max(64);
/**
 * Which identity to use. A desk speaks as staff, a player page as the player;
 * someone who is both never posts as the wrong one.
 */
const asSchema = z.enum(["player", "staff"]).optional();
const reasonSchema = z
  .enum(["offensive", "spam", "spoiler", "other"])
  .optional();

/**
 * Resolves the caller's chat identity from current membership: a player's
 * team, or a staff member's role, is read fresh on every request.
 */
const chatProcedure = publicProcedure
  .input(z.object({ as: asSchema }))
  .use(({ ctx, input, next }) => {
    const gameSession = ctx.gameSession;
    const gameId = gameSession?.id;
    if (typeof gameId !== "string") {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Not a valid game member for this game.",
      });
    }
    const userId = ctx.session?.user?.id;
    const staffRole =
      userId && "createdById" in gameSession
        ? staffRoleFor({
            createdById: gameSession.createdById,
            gameAdmin:
              gameSession.gameAdmin?.gameId === gameId
                ? gameSession.gameAdmin
                : null,
            userId,
          })
        : null;
    const player =
      "gameUser" in gameSession && gameSession.gameUser?.gameId === gameId
        ? gameSession.gameUser
        : null;

    let actor: ChatActor | null = null;
    if (input.as !== "staff" && player) {
      actor = {
        kind: "player",
        gameUserId: player.id,
        gameTeamId: player.gameTeamId,
      };
    } else if (input.as !== "player" && staffRole && userId) {
      actor = { kind: "staff", userId, role: staffRole };
    }
    if (!actor) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Not a valid game member for this game.",
      });
    }
    return next({ ctx: { ...ctx, gameId, actor } });
  });

/** Staff moderating chat, acting with their staff identity. */
const moderatorProcedure = staffProcedure("moderateChat").use(({ ctx, next }) =>
  next({
    ctx: {
      ...ctx,
      staffActor: {
        kind: "staff" as const,
        userId: ctx.session.user.id,
        role: ctx.staffRole,
      },
    },
  }),
);

async function control<T>(
  result: Promise<Result<T, Parameters<typeof toTRPCError>[0]>>,
) {
  const outcome = await result;
  if (outcome.isErr()) throw toTRPCError(outcome.error);
  return outcome.value;
}

export const chatRouter = createTRPCRouter({
  /** Whether chat is on, the caller's channels, and why they can't post. */
  status: chatProcedure.query(async ({ ctx }) =>
    chatStatus({ gameId: ctx.gameId, actor: ctx.actor }),
  ),
  /** Recent messages in one channel the caller can read. */
  channel: chatProcedure
    .input(
      z.object({
        channelKey: channelKeySchema,
        beforeSequence: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(CHAT_LIMITS.recentWindow).optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      control(
        recentMessages({
          gameId: ctx.gameId,
          actor: ctx.actor,
          channelKey: input.channelKey,
          beforeSequence: input.beforeSequence,
          limit: input.limit,
        }),
      ),
    ),
  send: chatProcedure
    .input(
      z.object({
        channelKey: channelKeySchema,
        // Characters, not bytes: the byte limit is checked after normalizing.
        body: z.string().max(CHAT_LIMITS.maxMessageBytes * 2),
        requestId: requestIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      control(
        sendMessage({
          gameId: ctx.gameId,
          actor: ctx.actor,
          channelKey: input.channelKey,
          body: input.body,
          requestId: input.requestId,
        }),
      ),
    ),

  /** Turns chat on or off for everyone. Owner and co-hosts. */
  setEnabled: protectedGameAdminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await control(
        setChatEnabled(ctx.gameSession.id, input.enabled),
      );
      if (result.changed) {
        await emitUpdatedGameState({ gameId: ctx.gameSession.id });
      }
      return result;
    }),

  moderation: createTRPCRouter({
    /** Newest messages across every channel, tagged with their channel. */
    recent: moderatorProcedure
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(CHAT_LIMITS.mergedMax),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) =>
        mergedRecent({
          gameId: ctx.gameSession.id,
          actor: ctx.staffActor,
          limit: input?.limit,
        }),
      ),
    mutes: moderatorProcedure.query(async ({ ctx }) =>
      listMutes(ctx.gameSession.id),
    ),
    remove: moderatorProcedure
      .input(z.object({ messageId: z.string(), reason: reasonSchema }))
      .mutation(async ({ ctx, input }) =>
        control(
          removeMessage({
            gameId: ctx.gameSession.id,
            messageId: input.messageId,
            staff: ctx.staffActor,
            reason: input.reason,
          }),
        ),
      ),
    mute: moderatorProcedure
      .input(
        z.object({
          actorKey: z.string().max(64),
          /** Minutes, or null for "until unmuted". Defaults to 10. */
          minutes: z
            .number()
            .int()
            .min(1)
            .max(24 * 60)
            .nullable()
            .optional(),
          reason: reasonSchema,
        }),
      )
      .mutation(async ({ ctx, input }) =>
        control(
          muteActor({
            gameId: ctx.gameSession.id,
            staff: ctx.staffActor,
            targetActorKey: input.actorKey,
            minutes: input.minutes,
            reason: input.reason,
          }),
        ),
      ),
    unmute: moderatorProcedure
      .input(z.object({ actorKey: z.string().max(64) }))
      .mutation(async ({ ctx, input }) =>
        control(
          unmuteActor({
            gameId: ctx.gameSession.id,
            staff: ctx.staffActor,
            targetActorKey: input.actorKey,
          }),
        ),
      ),
    setPolicy: moderatorProcedure
      .input(
        z.object({
          channelKey: channelKeySchema,
          staffOnly: z.boolean().optional(),
          slowModeSeconds: z
            .number()
            .int()
            .min(0)
            .max(CHAT_LIMITS.maxSlowModeSeconds)
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        control(setChannelPolicy({ gameId: ctx.gameSession.id, ...input })),
      ),
    pin: moderatorProcedure
      .input(
        z.object({
          channelKey: channelKeySchema,
          messageId: z.string().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        control(pinMessage({ gameId: ctx.gameSession.id, ...input })),
      ),
    clear: moderatorProcedure
      .input(z.object({ channelKey: channelKeySchema }))
      .mutation(async ({ ctx, input }) =>
        control(
          clearHistory({
            gameId: ctx.gameSession.id,
            channelKey: input.channelKey,
            staff: ctx.staffActor,
          }),
        ),
      ),
  }),
});
