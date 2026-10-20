import { createHash } from "node:crypto";

import { err, ok, type Result } from "neverthrow";

import { type StaffRoleName } from "@/utils/capabilities";
import { CHAT_LIMITS } from "@/utils/chatLimits";

export { CHAT_LIMITS } from "@/utils/chatLimits";

export type ChatBodyError =
  | { kind: "empty" }
  | { kind: "tooLong"; maxBytes: number }
  | { kind: "forbiddenCharacter" };

// Control characters other than newline and tab, plus bidi embedding,
// override and isolate controls that could make text render misleadingly.
const FORBIDDEN =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

/** Normalizes and checks a plain-text message body. */
export function normalizeChatBody(raw: string): Result<string, ChatBodyError> {
  const body = raw.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (body.length === 0) return err({ kind: "empty" });
  if (FORBIDDEN.test(body)) return err({ kind: "forbiddenCharacter" });
  if (Buffer.byteLength(body, "utf8") > CHAT_LIMITS.maxMessageBytes) {
    return err({ kind: "tooLong", maxBytes: CHAT_LIMITS.maxMessageBytes });
  }
  return ok(body);
}

export const hashBody = (body: string) =>
  createHash("sha256").update(body).digest("hex");

/** The chat identity of a player or a staff member. */
export type ChatActor =
  | { kind: "player"; gameUserId: string; gameTeamId: string | null }
  | { kind: "staff"; userId: string; role: StaffRoleName };

export function actorKey(actor: ChatActor): string {
  return actor.kind === "player"
    ? `player:${actor.gameUserId}`
    : `staff:${actor.userId}`;
}

export const GAME_CHANNEL_KEY = "game";
export const teamChannelKey = (gameTeamId: string) => `team:${gameTeamId}`;

/**
 * The channels an actor can read: everyone sees the game channel; in team
 * games players also see their current team's channel and staff see every
 * team's.
 */
export function channelKeysForActor(
  game: { isTeamGame: boolean; teamIds: readonly string[] },
  actor: ChatActor,
): string[] {
  if (!game.isTeamGame) return [GAME_CHANNEL_KEY];
  if (actor.kind === "staff") {
    return [GAME_CHANNEL_KEY, ...game.teamIds.map(teamChannelKey)];
  }
  return actor.gameTeamId
    ? [GAME_CHANNEL_KEY, teamChannelKey(actor.gameTeamId)]
    : [GAME_CHANNEL_KEY];
}

/**
 * Who may mute whom. Every staff role can mute players; owners and co-hosts
 * can also mute other helpers (co-hosts and moderators). Nobody can mute the
 * owner or themselves.
 */
export function canMute(
  muter: StaffRoleName,
  target: { kind: "player" } | { kind: "staff"; role: StaffRoleName },
  sameAccount: boolean,
): boolean {
  if (sameAccount) return false;
  if (target.kind === "player") return true;
  if (target.role === "owner") return false;
  if (muter === "owner") return true;
  if (muter === "cohost") return true;
  return false;
}
