import { createHash } from "node:crypto";

import { GameFormat, GameStatus } from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import { db } from "@/server/db";
import { staffRoleFor } from "@/server/staff/staffService";
import { type StaffRoleName } from "@/utils/capabilities";
import {
  actorKey,
  channelKeysForActor,
  type ChatActor,
} from "@/utils/chatRules";

/**
 * Everything needed to tell each chat viewer in a game what changed, loaded
 * once per game per change and shared by every live stream on this server.
 * It never contains message text: viewers fetch changed channels through the
 * normal access-checked queries.
 */
export type ChatSummary = {
  isTeamGame: boolean;
  teamIds: string[];
  enabled: boolean;
  finished: boolean;
  /** Revision of each channel that exists yet. */
  revisions: Record<string, number>;
  /** Changes whenever a name, team, removal or staff role changes. */
  rosterRevision: string;
  /** Current (not removed) players and their team. */
  players: Map<string, string | null>;
  staff: Map<string, StaffRoleName>;
  /** Mutes by actor key: until (epoch ms), or null for until unmuted. */
  mutes: Map<string, number | null>;
};

/**
 * One viewer's live chat signal: which of their channels changed and their
 * own posting state. Bounded by the number of teams, never message bodies.
 */
export type ChatPulse = {
  enabled: boolean;
  readOnly: boolean;
  muted: { until: Date | null } | null;
  channels: { key: string; revision: number }[];
  rosterRevision: string;
};

export type ChatPulseError = { kind: "removed" } | { kind: "roleRemoved" };

/** Who a live stream is following, fixed when it opens. */
export type ChatViewer =
  | { kind: "player"; gameUserId: string }
  | { kind: "staff"; userId: string };

export async function loadChatSummary(
  gameId: string,
): Promise<Result<ChatSummary, Error>> {
  const game = await db.game.findUnique({
    where: { id: gameId },
    select: {
      format: true,
      status: true,
      chatEnabled: true,
      createdById: true,
      gameTeams: {
        select: { id: true, name: true },
        orderBy: { index: "asc" },
      },
      gameUsers: {
        where: { removedAt: null },
        select: { id: true, name: true, gameTeamId: true },
        orderBy: { id: "asc" },
      },
      gameAdmins: {
        select: { userId: true, role: true },
        orderBy: { userId: "asc" },
      },
      chatChannels: { select: { key: true, revision: true } },
      chatMutes: { select: { actorKey: true, until: true } },
    },
  });
  if (!game) return err(new Error(`Game ${gameId} not found`));

  const staff = new Map<string, StaffRoleName>([[game.createdById, "owner"]]);
  for (const admin of game.gameAdmins) {
    const role = staffRoleFor({
      createdById: game.createdById,
      gameAdmin: admin,
      userId: admin.userId,
    });
    if (role) staff.set(admin.userId, role);
  }

  const rosterRevision = createHash("sha256")
    .update(
      JSON.stringify([
        game.gameTeams.map((t) => [t.id, t.name]),
        game.gameUsers.map((u) => [u.id, u.name, u.gameTeamId]),
        [...staff.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ]),
    )
    .digest("base64url")
    .slice(0, 16);

  return ok({
    isTeamGame: game.format === GameFormat.team,
    teamIds: game.gameTeams.map((t) => t.id),
    enabled: game.chatEnabled,
    finished: game.status === GameStatus.finished,
    revisions: Object.fromEntries(
      game.chatChannels.map((c) => [c.key, c.revision]),
    ),
    rosterRevision,
    players: new Map(game.gameUsers.map((u) => [u.id, u.gameTeamId])),
    staff,
    mutes: new Map(
      game.chatMutes.map((m) => [m.actorKey, m.until?.getTime() ?? null]),
    ),
  });
}

/**
 * Projects the shared summary for one viewer using **current** membership:
 * a moved player's channels change at once, and a removed player or
 * revoked helper gets an error instead of further updates.
 */
export function projectChatPulse(
  summary: ChatSummary,
  viewer: ChatViewer,
  now = Date.now(),
): Result<ChatPulse, ChatPulseError> {
  let actor: ChatActor;
  if (viewer.kind === "player") {
    if (!summary.players.has(viewer.gameUserId)) {
      return err({ kind: "removed" });
    }
    actor = {
      kind: "player",
      gameUserId: viewer.gameUserId,
      gameTeamId: summary.players.get(viewer.gameUserId) ?? null,
    };
  } else {
    const role = summary.staff.get(viewer.userId);
    if (!role) return err({ kind: "roleRemoved" });
    actor = { kind: "staff", userId: viewer.userId, role };
  }

  const mute = summary.mutes.get(actorKey(actor));
  const muted =
    mute === undefined || (mute !== null && mute <= now)
      ? null
      : { until: mute === null ? null : new Date(mute) };

  return ok({
    enabled: summary.enabled,
    readOnly: summary.finished && actor.kind === "player",
    muted,
    channels: channelKeysForActor(summary, actor).map((key) => ({
      key,
      revision: summary.revisions[key] ?? 0,
    })),
    rosterRevision: summary.rosterRevision,
  });
}
