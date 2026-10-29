import { TRPCError } from "@trpc/server";
import type { Result } from "neverthrow";
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
import { isStillStaff, staffRoleFor } from "@/server/staff/staffService";
import { db } from "@/server/db";
import {
  projectChatPulse,
  type ChatPulse,
  type ChatViewer,
} from "@/server/chat/chatLive";
import {
  emitChatChanged,
  emitUpdatedGameState,
  endWhenGameDeleted,
  liveFeeds,
} from "@/server/utils/events";
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

/** Like `control`, then tells live viewers the game's chat changed. */
async function announce<T>(
  gameId: string,
  result: Promise<Result<T, Parameters<typeof toTRPCError>[0]>>,
) {
  const value = await control(result);
  await emitChatChanged(gameId);
  return value;
}

const sameChannels = (a: ChatPulse, b: ChatPulse) =>
  JSON.stringify(a) === JSON.stringify(b);

export const chatRouter = createTRPCRouter({
  /** Whether chat is on, the caller's channels, and why they can't post. */
  status: chatProcedure.query(async ({ ctx }) =>
    chatStatus({ gameId: ctx.gameId, actor: ctx.actor }),
  ),
  /**
   * Live chat signal: the caller's channels with their revisions, their
   * posting state and a roster revision. Sent first on connect and again
   * whenever any of it changes, never with message text. Clients re-fetch
   * a channel when its revision changes, and drop channels that disappear.
   * Access is re-checked against current membership on every change.
   */
  live: chatProcedure.subscription(async function* ({ ctx, signal }) {
    const viewer: ChatViewer =
      ctx.actor.kind === "player"
        ? { kind: "player", gameUserId: ctx.actor.gameUserId }
        : { kind: "staff", userId: ctx.actor.userId };
    let last: ChatPulse | undefined;
    for await (const summary of endWhenGameDeleted(
      liveFeeds.chat.subscribe(ctx.gameId, signal),
    )) {
      const pulse = projectChatPulse(summary, viewer);
      if (pulse.isErr()) {
        // The summary may predate this viewer joining or being invited:
        // check before ending the stream.
        const stillHere =
          viewer.kind === "player"
            ? !!(await db.gameUser.findFirst({
                where: { id: viewer.gameUserId, removedAt: null },
                select: { id: true },
              }))
            : await isStillStaff(ctx.gameId, viewer.userId);
        if (stillHere) continue;
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            pulse.error.kind === "removed"
              ? "You were removed from this game."
              : "Your role in this game was removed.",
        });
      }
      // Most changes are in channels this viewer can't see; skip those.
      if (last && sameChannels(last, pulse.value)) continue;
      last = pulse.value;
      yield pulse.value;
    }
  }),
  /** Recent messages in one channel the caller can read. */
  channel: chatProcedure
    .input(
      z.object({
        channelKey: channelKeySchema,
        beforeSequence: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(CHAT_LIMITS.recentWindow).optional(),
        /** The view held: only newer messages come back if nothing else changed. */
        since: z
          .object({
            revision: z.number().int().min(0),
            afterSequence: z.number().int().min(0),
          })
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      control(
        recentMessages({
          gameId: ctx.gameId,
          actor: ctx.actor,
          channelKey: input.channelKey,
          beforeSequence: input.beforeSequence,
          since: input.since,
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
    .mutation(async ({ ctx, input }) => {
      const result = await control(
        sendMessage({
          gameId: ctx.gameId,
          actor: ctx.actor,
          channelKey: input.channelKey,
          body: input.body,
          requestId: input.requestId,
        }),
      );
      if (!result.replayed) await emitChatChanged(ctx.gameId);
      return result;
    }),

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
        announce(
          ctx.gameSession.id,
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
        announce(
          ctx.gameSession.id,
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
        announce(
          ctx.gameSession.id,
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
        announce(
          ctx.gameSession.id,
          setChannelPolicy({ gameId: ctx.gameSession.id, ...input }),
        ),
      ),
    pin: moderatorProcedure
      .input(
        z.object({
          channelKey: channelKeySchema,
          messageId: z.string().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        announce(
          ctx.gameSession.id,
          pinMessage({ gameId: ctx.gameSession.id, ...input }),
        ),
      ),
    clear: moderatorProcedure
      .input(z.object({ channelKey: channelKeySchema }))
      .mutation(async ({ ctx, input }) =>
        announce(
          ctx.gameSession.id,
          clearHistory({
            gameId: ctx.gameSession.id,
            channelKey: input.channelKey,
            staff: ctx.staffActor,
          }),
        ),
      ),
  }),
});
