import { createHash, randomUUID } from "node:crypto";

import {
  GameFormat,
  GameStatus,
  Prisma,
  type ChatChannel,
  type ChatMessage,
} from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import { db } from "@/server/db";
import {
  lockChatGate,
  withGameLock,
  type GameTransactionError,
  type GameTx,
} from "@/server/db/gameTransaction";
import { staffRoleFor } from "@/server/staff/staffService";
import { takeChatAllowance } from "@/server/utils/rateLimit";
import { ROLE_LABEL, type StaffRoleName } from "@/utils/capabilities";
import {
  actorKey,
  canMute,
  channelKeysForActor,
  CHAT_LIMITS,
  GAME_CHANNEL_KEY,
  hashBody,
  normalizeChatBody,
  teamChannelKey,
  type ChatActor,
  type ChatBodyError,
} from "@/utils/chatRules";

export type ChatError =
  | GameTransactionError
  | { kind: "chatDisabled" }
  | { kind: "chatClosed" }
  | { kind: "channelNotFound" }
  | { kind: "channelStaffOnly" }
  | { kind: "muted"; until: Date | null }
  | { kind: "slowMode"; retryAfterSeconds: number }
  | { kind: "chatTooFast"; retryAfterSeconds: number }
  | { kind: "chatBusy" }
  | { kind: "chatUnavailable" }
  | { kind: "invalidMessage"; error: ChatBodyError }
  | { kind: "requestIdReused" }
  | { kind: "messageNotFound" }
  | { kind: "muteTargetNotFound" }
  | { kind: "cannotMute" };

/** Replaces the body hash on removal and expiry: short texts are guessable. */
const REDACTED_HASH = "redacted";

const RETENTION_MS = CHAT_LIMITS.retentionDays * 24 * 60 * 60 * 1000;

export type ChatAuthor = {
  kind: "player" | "staff";
  /** Current name: moderated names apply to old messages too. */
  name: string;
  /** Staff role badge, derived from current membership. */
  roleLabel: string | null;
  /** Team name for players in team games. */
  teamName: string | null;
};

export type ChatMessageView = {
  id: string;
  sequence: number;
  channelKey: string;
  author: ChatAuthor;
  /** Null once removed by staff or expired by retention. */
  body: string | null;
  state: "visible" | "removed" | "expired";
  createdAt: Date;
  isOwn: boolean;
  /** Staff only: who wrote it, for mute and rename actions. */
  actorKey?: string;
};

function flatten<T>(
  result: Result<Result<T, ChatError>, GameTransactionError>,
): Result<T, ChatError> {
  return result.isErr() ? err(result.error) : result.value;
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/** Keys of the channels an actor can read, for a game's format. */
export async function channelKeysFor(
  gameId: string,
  actor: ChatActor,
): Promise<string[]> {
  const game = await db.game.findUniqueOrThrow({
    where: { id: gameId },
    select: {
      format: true,
      gameTeams: { select: { id: true }, orderBy: { index: "asc" } },
    },
  });
  return channelKeysForActor(
    {
      isTeamGame: game.format === GameFormat.team,
      teamIds: game.gameTeams.map((team) => team.id),
    },
    actor,
  );
}

/**
 * Whether an actor may read a channel, from current membership: a player
 * moved to another team loses their old team's channel at once.
 */
function canRead(actor: ChatActor, key: string) {
  if (key === GAME_CHANNEL_KEY) return true;
  if (actor.kind === "staff") return key.startsWith("team:");
  return actor.gameTeamId !== null && key === teamChannelKey(actor.gameTeamId);
}

/** Finds or creates a channel, checking that a team channel's team exists. */
async function resolveChannel(
  client: GameTx | typeof db,
  gameId: string,
  key: string,
): Promise<ChatChannel | null> {
  const existing = await client.chatChannel.findUnique({
    where: { gameId_key: { gameId, key } },
  });
  if (existing) return existing;

  let gameTeamId: string | null = null;
  if (key !== GAME_CHANNEL_KEY) {
    const teamId = key.startsWith("team:") ? key.slice(5) : "";
    const team = await client.gameTeam.findFirst({
      where: { id: teamId, gameId, game: { format: GameFormat.team } },
      select: { id: true },
    });
    if (!team) return null;
    gameTeamId = team.id;
  }
  // ON CONFLICT rather than catching a unique violation: inside a
  // transaction a failed insert would abort everything after it, and two
  // first messages to a channel can arrive together.
  await client.$executeRaw`
    INSERT INTO "ChatChannel" (id, "gameId", key, "gameTeamId")
    VALUES (${randomUUID()}, ${gameId}, ${key}, ${gameTeamId})
    ON CONFLICT ("gameId", key) DO NOTHING`;
  return client.chatChannel.findUnique({
    where: { gameId_key: { gameId, key } },
  });
}

async function activeMute(
  client: GameTx | typeof db,
  gameId: string,
  key: string,
  now: Date,
) {
  const mute = await client.chatMute.findUnique({
    where: { gameId_actorKey: { gameId, actorKey: key } },
  });
  if (!mute) return null;
  if (mute.until && mute.until <= now) return null;
  return mute;
}

/** Builds author labels for many messages with one query per kind. */
async function authorsFor(gameId: string, keys: string[]) {
  const playerIds = keys
    .filter((k) => k.startsWith("player:"))
    .map((k) => k.slice(7));
  const staffIds = keys
    .filter((k) => k.startsWith("staff:"))
    .map((k) => k.slice(6));
  const [players, game] = await Promise.all([
    db.gameUser.findMany({
      where: { id: { in: playerIds }, gameId },
      select: {
        id: true,
        name: true,
        removedAt: true,
        gameTeam: { select: { name: true } },
      },
    }),
    db.game.findUniqueOrThrow({
      where: { id: gameId },
      select: {
        format: true,
        createdById: true,
        gameAdmins: {
          where: { userId: { in: staffIds } },
          select: { userId: true, role: true },
        },
      },
    }),
  ]);

  const authors = new Map<string, ChatAuthor>();
  for (const player of players) {
    authors.set(`player:${player.id}`, {
      kind: "player",
      // Removed players get a neutral label, never their old name.
      name: player.removedAt ? "Removed player" : player.name,
      roleLabel: null,
      teamName:
        game.format === GameFormat.team && !player.removedAt
          ? (player.gameTeam?.name ?? null)
          : null,
    });
  }
  for (const userId of staffIds) {
    const role = staffRoleFor({
      createdById: game.createdById,
      gameAdmin: game.gameAdmins.find((a) => a.userId === userId),
      userId,
    });
    // Staff appear as "Organizer"; account names are never published.
    authors.set(`staff:${userId}`, {
      kind: "staff",
      name: "Organizer",
      roleLabel: role ? ROLE_LABEL[role] : null,
      teamName: null,
    });
  }
  return authors;
}

function toView(
  message: ChatMessage,
  channelKey: string,
  authors: Map<string, ChatAuthor>,
  viewer: ChatActor,
  now: Date,
): ChatMessageView {
  const expired =
    !!message.expiredAt ||
    now.getTime() - message.createdAt.getTime() > RETENTION_MS;
  const state = message.removedAt ? "removed" : expired ? "expired" : "visible";
  return {
    id: message.id,
    sequence: message.sequence,
    channelKey,
    author: authors.get(message.actorKey) ?? {
      kind: message.actorKey.startsWith("staff:") ? "staff" : "player",
      name: message.actorKey.startsWith("staff:")
        ? "Organizer"
        : "Removed player",
      roleLabel: null,
      teamName: null,
    },
    body: state === "visible" ? message.body : null,
    state,
    createdAt: message.createdAt,
    isOwn: message.actorKey === actorKey(viewer),
    ...(viewer.kind === "staff" ? { actorKey: message.actorKey } : {}),
  };
}

async function viewsOf(
  gameId: string,
  rows: (ChatMessage & { channel?: { key: string } })[],
  viewer: ChatActor,
  now: Date,
  channelKey?: string,
) {
  const authors = await authorsFor(gameId, [
    ...new Set(rows.map((r) => r.actorKey)),
  ]);
  return rows.map((row) =>
    toView(row, channelKey ?? row.channel!.key, authors, viewer, now),
  );
}

export type SendResult = {
  message: ChatMessageView;
  /** True when this request ID was already accepted. */
  replayed: boolean;
};

/**
 * Accepts a message: persisted before it is acknowledged. A retry with the
 * same request ID and text returns the original message as it is now (a
 * removed message stays removed); different text is refused.
 */
export async function sendMessage({
  gameId,
  actor,
  channelKey,
  body: rawBody,
  requestId,
  now = new Date(),
}: {
  gameId: string;
  actor: ChatActor;
  channelKey: string;
  body: string;
  requestId: string;
  now?: Date;
}): Promise<Result<SendResult, ChatError>> {
  const normalized = normalizeChatBody(rawBody);
  if (normalized.isErr()) {
    return err({ kind: "invalidMessage", error: normalized.error });
  }
  const body = normalized.value;
  const key = actorKey(actor);
  const bodyHash = hashBody(body);

  const replay = async (): Promise<Result<SendResult, ChatError> | null> => {
    const existing = await db.chatMessage.findUnique({
      where: {
        gameId_actorKey_requestId: { gameId, actorKey: key, requestId },
      },
      include: { channel: { select: { key: true } } },
    });
    if (!existing) return null;
    // Redacted messages keep no hash of their text, so any retry of the
    // same request ID gets the tombstone back rather than a new message.
    const redacted = existing.bodyHash === REDACTED_HASH;
    if (
      existing.channel.key !== channelKey ||
      (!redacted && existing.bodyHash !== bodyHash)
    ) {
      return err({ kind: "requestIdReused" });
    }
    const [message] = await viewsOf(gameId, [existing], actor, now);
    return ok({ message: message!, replayed: true });
  };

  const earlier = await replay();
  if (earlier) return earlier;
  if (!canRead(actor, channelKey)) return err({ kind: "channelNotFound" });

  const allowance = await takeChatAllowance({
    gameId,
    actorKey: key,
    limits: CHAT_LIMITS,
  });
  if (!allowance.allowed) {
    if (allowance.reason === "tooFast") {
      return err({
        kind: "chatTooFast",
        retryAfterSeconds: allowance.retryAfterSeconds,
      });
    }
    return err({
      kind: allowance.reason === "gameBusy" ? "chatBusy" : "chatUnavailable",
    });
  }

  try {
    const result = await db.$transaction(
      async (tx): Promise<Result<ChatMessage, ChatError>> => {
        // Shared chat lock: sends don't block each other (or buzzes and
        // scores), but a mute, finish or channel-policy change can't
        // interleave with the checks below.
        await lockChatGate(tx, gameId, "shared");
        const [game] = await tx.$queryRaw<
          { status: GameStatus; chatEnabled: boolean }[]
        >`SELECT status, "chatEnabled" FROM "Game" WHERE id = ${gameId}`;
        if (!game) return err({ kind: "gameNotFound", gameId });
        if (!game.chatEnabled) return err({ kind: "chatDisabled" });
        if (game.status === GameStatus.finished && actor.kind === "player") {
          return err({ kind: "chatClosed" });
        }

        const channel = await resolveChannel(tx, gameId, channelKey);
        if (!channel) return err({ kind: "channelNotFound" });
        if (channel.staffOnly && actor.kind === "player") {
          return err({ kind: "channelStaffOnly" });
        }

        const mute = await activeMute(tx, gameId, key, now);
        if (mute) return err({ kind: "muted", until: mute.until });

        if (channel.slowModeSeconds > 0 && actor.kind === "player") {
          const last = await tx.chatMessage.findFirst({
            where: { channelId: channel.id, actorKey: key },
            orderBy: { sequence: "desc" },
            select: { createdAt: true },
          });
          const waitMs = last
            ? last.createdAt.getTime() +
              channel.slowModeSeconds * 1000 -
              now.getTime()
            : 0;
          if (waitMs > 0) {
            return err({
              kind: "slowMode",
              retryAfterSeconds: Math.ceil(waitMs / 1000),
            });
          }
        }

        const updated = await tx.chatChannel.update({
          where: { id: channel.id },
          data: { lastSequence: { increment: 1 }, revision: { increment: 1 } },
          select: { lastSequence: true },
        });
        const message = await tx.chatMessage.create({
          data: {
            gameId,
            channelId: channel.id,
            sequence: updated.lastSequence,
            actorKey: key,
            requestId,
            bodyHash,
            body,
            createdAt: now,
          },
        });
        return ok(message);
      },
    );
    if (result.isErr()) return err(result.error);
    const [message] = await viewsOf(
      gameId,
      [result.value],
      actor,
      now,
      channelKey,
    );
    return ok({ message: message!, replayed: false });
  } catch (error) {
    // A concurrent retry of the same request won the race.
    if (isUniqueViolation(error)) {
      const raced = await replay();
      if (raced) return raced;
    }
    throw error;
  }
}

export type ChannelView = {
  key: string;
  label: string;
  staffOnly: boolean;
  slowModeSeconds: number;
  revision: number;
  pinned: ChatMessageView | null;
  /** Messages at or before this sequence are outside the recent window. */
  windowStartsAfter: number;
  hasOlder: boolean;
  messages: ChatMessageView[];
};

async function channelLabel(gameId: string, key: string) {
  if (key === GAME_CHANNEL_KEY) return "Everyone";
  const team = await db.gameTeam.findFirst({
    where: { id: key.slice(5), gameId },
    select: { name: true },
  });
  return team ? `Team: ${team.name}` : "Team";
}

/**
 * The newest messages in one channel the actor can read, from the bounded
 * recent window. `beforeSequence` pages back within that window only.
 */
export async function recentMessages({
  gameId,
  actor,
  channelKey,
  beforeSequence,
  limit = CHAT_LIMITS.initialMessages,
  now = new Date(),
}: {
  gameId: string;
  actor: ChatActor;
  channelKey: string;
  beforeSequence?: number;
  limit?: number;
  now?: Date;
}): Promise<Result<ChannelView, ChatError>> {
  if (!canRead(actor, channelKey)) return err({ kind: "channelNotFound" });
  const channel = await resolveChannel(db, gameId, channelKey);
  if (!channel) return err({ kind: "channelNotFound" });

  const windowStartsAfter = Math.max(
    channel.clearedThroughSequence,
    channel.lastSequence - CHAT_LIMITS.recentWindow,
  );
  const take = Math.min(Math.max(1, limit), CHAT_LIMITS.recentWindow);
  const rows = await db.chatMessage.findMany({
    where: {
      channelId: channel.id,
      sequence: {
        gt: windowStartsAfter,
        ...(beforeSequence !== undefined ? { lt: beforeSequence } : {}),
      },
    },
    orderBy: { sequence: "desc" },
    take,
  });
  rows.reverse();
  const pinnedRow =
    channel.pinnedMessageId !== null
      ? await db.chatMessage.findFirst({
          where: { id: channel.pinnedMessageId, channelId: channel.id },
        })
      : null;

  const views = await viewsOf(
    gameId,
    pinnedRow ? [...rows, pinnedRow] : rows,
    actor,
    now,
    channelKey,
  );
  const pinned = pinnedRow ? views.pop()! : null;
  return ok({
    key: channel.key,
    label: await channelLabel(gameId, channel.key),
    staffOnly: channel.staffOnly,
    slowModeSeconds: channel.slowModeSeconds,
    revision: channel.revision,
    pinned: pinned?.state === "visible" ? pinned : null,
    windowStartsAfter,
    hasOlder:
      (views[0]?.sequence ?? channel.lastSequence + 1) - 1 > windowStartsAfter,
    messages: views,
  });
}

/**
 * Staff "all recent channels" view: the newest messages across every channel,
 * each tagged with its channel. Bounded; not an archive or search.
 */
export async function mergedRecent({
  gameId,
  actor,
  limit = CHAT_LIMITS.mergedDefault,
  now = new Date(),
}: {
  gameId: string;
  actor: Extract<ChatActor, { kind: "staff" }>;
  limit?: number;
  now?: Date;
}) {
  const channels = await db.chatChannel.findMany({
    where: { gameId },
    select: { id: true, key: true, clearedThroughSequence: true },
  });
  if (channels.length === 0) return [];
  const rows = await db.chatMessage.findMany({
    where: {
      OR: channels.map((c) => ({
        channelId: c.id,
        sequence: { gt: c.clearedThroughSequence },
      })),
    },
    orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
    take: Math.min(Math.max(1, limit), CHAT_LIMITS.mergedMax),
    include: { channel: { select: { key: true } } },
  });
  rows.reverse();
  const views = await viewsOf(gameId, rows, actor, now);
  const labels = new Map<string, string>();
  for (const key of new Set(views.map((v) => v.channelKey))) {
    labels.set(key, await channelLabel(gameId, key));
  }
  return views.map((view) => ({
    ...view,
    channelLabel: labels.get(view.channelKey) ?? view.channelKey,
  }));
}

/** What an actor can do in chat right now, for disabled states. */
export async function chatStatus({
  gameId,
  actor,
  now = new Date(),
}: {
  gameId: string;
  actor: ChatActor;
  now?: Date;
}) {
  const [game, mute, keys] = await Promise.all([
    db.game.findUniqueOrThrow({
      where: { id: gameId },
      select: { chatEnabled: true, status: true },
    }),
    activeMute(db, gameId, actorKey(actor), now),
    channelKeysFor(gameId, actor),
  ]);
  const channels = await db.chatChannel.findMany({
    where: { gameId, key: { in: keys } },
    select: {
      key: true,
      staffOnly: true,
      slowModeSeconds: true,
      revision: true,
    },
  });
  return {
    enabled: game.chatEnabled,
    readOnly: game.status === GameStatus.finished && actor.kind === "player",
    muted: mute ? { until: mute.until } : null,
    channels: await Promise.all(
      keys.map(async (key) => {
        const channel = channels.find((c) => c.key === key);
        return {
          key,
          label: await channelLabel(gameId, key),
          staffOnly: channel?.staffOnly ?? false,
          slowModeSeconds: channel?.slowModeSeconds ?? 0,
          revision: channel?.revision ?? 0,
        };
      }),
    ),
  };
}

/** Records a moderation action for staff (reason expires after 30 days). */
async function logModeration(
  tx: GameTx,
  gameId: string,
  actorUserId: string,
  action: string,
  details: Prisma.InputJsonObject,
) {
  await tx.gameOperation.create({
    data: {
      gameId,
      requestId: `mod-${randomUUID().replaceAll("-", "")}`,
      action,
      actorUserId,
      payloadHash: createHash("sha256")
        .update(JSON.stringify({ action, details }))
        .digest("hex"),
      result: details,
    },
  });
}

async function bumpChannel(
  tx: GameTx,
  channelId: string,
  data: Prisma.ChatChannelUpdateInput = {},
) {
  return tx.chatChannel.update({
    where: { id: channelId },
    data: { ...data, revision: { increment: 1 } },
  });
}

type StaffActor = Extract<ChatActor, { kind: "staff" }>;
type Changed = { changed: boolean };

/** Removes a message's text for everyone. It cannot be restored. */
export async function removeMessage({
  gameId,
  messageId,
  staff,
  reason,
  now = new Date(),
}: {
  gameId: string;
  messageId: string;
  staff: StaffActor;
  reason?: string;
  now?: Date;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<Changed, ChatError>> => {
        const message = await tx.chatMessage.findFirst({
          where: { id: messageId, gameId },
          include: { channel: true },
        });
        if (!message) return err({ kind: "messageNotFound" });
        if (message.removedAt) return ok({ changed: false });
        await tx.chatMessage.update({
          where: { id: messageId },
          data: {
            body: null,
            bodyHash: REDACTED_HASH,
            removedAt: now,
            removedById: staff.userId,
          },
        });
        await bumpChannel(
          tx,
          message.channelId,
          message.channel.pinnedMessageId === messageId
            ? { pinnedMessageId: null }
            : {},
        );
        await logModeration(tx, gameId, staff.userId, "chat.remove", {
          target: message.actorKey,
          channel: message.channel.key,
          ...(reason ? { reason } : {}),
        });
        return ok({ changed: true });
      },
    ),
  );
}

async function targetRole(
  tx: GameTx,
  gameId: string,
  targetKey: string,
): Promise<{ kind: "player" } | { kind: "staff"; role: StaffRoleName } | null> {
  if (targetKey.startsWith("player:")) {
    const player = await tx.gameUser.findFirst({
      where: { id: targetKey.slice(7), gameId, removedAt: null },
      select: { id: true },
    });
    return player ? { kind: "player" } : null;
  }
  if (targetKey.startsWith("staff:")) {
    const userId = targetKey.slice(6);
    const game = await tx.game.findUniqueOrThrow({
      where: { id: gameId },
      select: {
        createdById: true,
        gameAdmins: { where: { userId }, select: { userId: true, role: true } },
      },
    });
    const role = staffRoleFor({
      createdById: game.createdById,
      gameAdmin: game.gameAdmins[0],
      userId,
    });
    return role ? { kind: "staff", role } : null;
  }
  return null;
}

/**
 * Mutes someone's chat across the game. `minutes: null` lasts until unmuted.
 * Muting never stops buzzing, answering or scoring.
 */
export async function muteActor({
  gameId,
  staff,
  targetActorKey,
  minutes = CHAT_LIMITS.defaultMuteMinutes,
  reason,
  now = new Date(),
}: {
  gameId: string;
  staff: StaffActor;
  targetActorKey: string;
  minutes?: number | null;
  reason?: string;
  now?: Date;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<{ until: Date | null }, ChatError>> => {
        await lockChatGate(tx, gameId, "exclusive");
        const target = await targetRole(tx, gameId, targetActorKey);
        if (!target) return err({ kind: "muteTargetNotFound" });
        if (!canMute(staff.role, target, targetActorKey === actorKey(staff))) {
          return err({ kind: "cannotMute" });
        }
        const until =
          minutes === null ? null : new Date(now.getTime() + minutes * 60_000);
        await tx.chatMute.upsert({
          where: { gameId_actorKey: { gameId, actorKey: targetActorKey } },
          create: {
            gameId,
            actorKey: targetActorKey,
            until,
            createdById: staff.userId,
            createdAt: now,
          },
          update: { until, createdById: staff.userId, createdAt: now },
        });
        await logModeration(tx, gameId, staff.userId, "chat.mute", {
          target: targetActorKey,
          until: until?.toISOString() ?? null,
          ...(reason ? { reason } : {}),
        });
        return ok({ until });
      },
    ),
  );
}

export async function unmuteActor({
  gameId,
  staff,
  targetActorKey,
}: {
  gameId: string;
  staff: StaffActor;
  targetActorKey: string;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<Changed, ChatError>> => {
        const { count } = await tx.chatMute.deleteMany({
          where: { gameId, actorKey: targetActorKey },
        });
        if (count > 0) {
          await logModeration(tx, gameId, staff.userId, "chat.unmute", {
            target: targetActorKey,
          });
        }
        return ok({ changed: count > 0 });
      },
    ),
  );
}

/** Current mutes, for the staff view. */
export async function listMutes(gameId: string, now = new Date()) {
  const mutes = await db.chatMute.findMany({
    where: { gameId, OR: [{ until: null }, { until: { gt: now } }] },
    orderBy: { createdAt: "asc" },
  });
  const authors = await authorsFor(
    gameId,
    mutes.map((m) => m.actorKey),
  );
  return mutes.map((mute) => ({
    actorKey: mute.actorKey,
    name: authors.get(mute.actorKey)?.name ?? "Removed player",
    until: mute.until,
  }));
}

async function channelForUpdate(
  tx: GameTx,
  gameId: string,
  channelKey: string,
) {
  return resolveChannel(tx, gameId, channelKey);
}

/** Staff-only posting and slow mode for one channel. */
export async function setChannelPolicy({
  gameId,
  channelKey,
  staffOnly,
  slowModeSeconds,
}: {
  gameId: string;
  channelKey: string;
  staffOnly?: boolean;
  slowModeSeconds?: number;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<Changed, ChatError>> => {
        await lockChatGate(tx, gameId, "exclusive");
        const channel = await channelForUpdate(tx, gameId, channelKey);
        if (!channel) return err({ kind: "channelNotFound" });
        const slow =
          slowModeSeconds === undefined
            ? undefined
            : Math.min(
                Math.max(0, Math.floor(slowModeSeconds)),
                CHAT_LIMITS.maxSlowModeSeconds,
              );
        if (
          (staffOnly === undefined || staffOnly === channel.staffOnly) &&
          (slow === undefined || slow === channel.slowModeSeconds)
        ) {
          return ok({ changed: false });
        }
        await bumpChannel(tx, channel.id, {
          staffOnly,
          slowModeSeconds: slow,
        });
        return ok({ changed: true });
      },
    ),
  );
}

/** Pins one visible message in its channel, or unpins with `null`. */
export async function pinMessage({
  gameId,
  channelKey,
  messageId,
}: {
  gameId: string;
  channelKey: string;
  messageId: string | null;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<Changed, ChatError>> => {
        const channel = await channelForUpdate(tx, gameId, channelKey);
        if (!channel) return err({ kind: "channelNotFound" });
        if (messageId !== null) {
          const message = await tx.chatMessage.findFirst({
            where: {
              id: messageId,
              channelId: channel.id,
              removedAt: null,
              sequence: { gt: channel.clearedThroughSequence },
            },
            select: { id: true },
          });
          if (!message) return err({ kind: "messageNotFound" });
        }
        if (channel.pinnedMessageId === messageId)
          return ok({ changed: false });
        await bumpChannel(tx, channel.id, { pinnedMessageId: messageId });
        return ok({ changed: true });
      },
    ),
  );
}

/**
 * Hides every message so far in one channel for everyone and unpins. This is
 * not a permanent erasure of stored data or backups.
 */
export async function clearHistory({
  gameId,
  channelKey,
  staff,
}: {
  gameId: string;
  channelKey: string;
  staff: StaffActor;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<Changed, ChatError>> => {
        const channel = await channelForUpdate(tx, gameId, channelKey);
        if (!channel) return err({ kind: "channelNotFound" });
        if (
          channel.clearedThroughSequence === channel.lastSequence &&
          !channel.pinnedMessageId
        ) {
          return ok({ changed: false });
        }
        await bumpChannel(tx, channel.id, {
          clearedThroughSequence: channel.lastSequence,
          pinnedMessageId: null,
        });
        await logModeration(tx, gameId, staff.userId, "chat.clear", {
          channel: channel.key,
        });
        return ok({ changed: true });
      },
    ),
  );
}

/** Turns chat on or off for the whole game. */
export async function setChatEnabled(gameId: string, enabled: boolean) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<Changed, ChatError>> => {
        await lockChatGate(tx, gameId, "exclusive");
        const { count } = await tx.game.updateMany({
          where: { id: gameId, chatEnabled: !enabled },
          data: { chatEnabled: enabled },
        });
        return ok({ changed: count > 0 });
      },
    ),
  );
}

/**
 * Applies retention: removes chat bodies older than the retention period,
 * drops expired mutes, and strips moderation reasons older than 30 days.
 * Safe to run repeatedly; reads also hide expired bodies if this runs late.
 */
export async function cleanupChat(now = new Date()) {
  const bodyCutoff = new Date(now.getTime() - RETENTION_MS);
  const reasonCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [expiredBodies, expiredMutes, strippedReasons] = await Promise.all([
    db.chatMessage.updateMany({
      where: { body: { not: null }, createdAt: { lt: bodyCutoff } },
      data: { body: null, bodyHash: REDACTED_HASH, expiredAt: now },
    }),
    db.chatMute.deleteMany({ where: { until: { lt: now } } }),
    db.$executeRaw`
      UPDATE "GameOperation" SET result = result - 'reason'
      WHERE action LIKE 'chat.%' AND "createdAt" < ${reasonCutoff}
        AND result ? 'reason'`,
  ]);
  return {
    expiredBodies: expiredBodies.count,
    expiredMutes: expiredMutes.count,
    strippedReasons,
  };
}
