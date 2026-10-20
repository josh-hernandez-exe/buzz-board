import { createHash } from "node:crypto";

import { err, ok, type Result } from "neverthrow";

import { type StaffRoleName } from "@/utils/capabilities";

export const CHAT_LIMITS = {
  /** Plain-text message size, in UTF-8 bytes. */
  maxMessageBytes: 2_000,
  /** Messages loaded when a channel opens. */
  initialMessages: 50,
  /** Most recent messages that can be scrolled back to in one channel. */
  recentWindow: 200,
  /** Default and maximum size of the staff "all recent channels" view. */
  mergedDefault: 100,
  mergedMax: 200,
  /** Per person: at most this many messages in a burst… */
  burstMessages: 5,
  burstSeconds: 10,
  /** …and at most this many per minute. */
  perMinute: 30,
  /** Accepted messages per game per second, across everyone. */
  gamePerSecond: 50,
  /** Message bodies are removed this long after sending. */
  retentionDays: 7,
  defaultMuteMinutes: 10,
  maxSlowModeSeconds: 600,
} as const;

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
