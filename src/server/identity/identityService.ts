import { GameFormat, InvitePurpose, type GameUser } from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import { db } from "@/server/db";
import {
  withGameLock,
  type GameTransactionError,
} from "@/server/db/gameTransaction";
import { hashToken } from "@/server/staff/staffService";
import { generateToken } from "@/server/utils/codeGeneration";
import { RECOVERY_LINK_LIFETIME_MINUTES } from "@/utils/capabilities";

export type IdentityError =
  | GameTransactionError
  | { kind: "playerNotFound" }
  /** The player is saved to an account; they sign in to get back in. */
  | { kind: "playerLinked" }
  /** The player is saved to a different account than the one signed in. */
  | { kind: "linkedToOtherAccount" }
  /** This account already has a different player in this game. */
  | { kind: "accountHasOtherPlayer"; playerName: string }
  | { kind: "inviteNotFound" }
  | { kind: "inviteUsed" }
  | { kind: "inviteRevoked" }
  | { kind: "inviteExpired" };

function flatten<T>(
  result: Result<Result<T, IdentityError>, GameTransactionError>,
): Result<T, IdentityError> {
  return result.isErr() ? err(result.error) : result.value;
}

/**
 * Saves a guest player to the signed-in account, so they can get back in on
 * another device by signing in. Only done when the player asks; signing in
 * never links a player silently, and a player is never moved between
 * accounts.
 */
export async function linkPlayerToAccount({
  gameId,
  gameUserId,
  userId,
}: {
  gameId: string;
  gameUserId: string;
  userId: string;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<{ changed: boolean }, IdentityError>> => {
        const player = await tx.gameUser.findFirst({
          where: { id: gameUserId, gameId, removedAt: null },
        });
        if (!player) return err({ kind: "playerNotFound" });
        if (player.userId === userId) return ok({ changed: false });
        if (player.userId) return err({ kind: "linkedToOtherAccount" });

        const other = await tx.gameUser.findFirst({
          where: { gameId, userId, removedAt: null, id: { not: gameUserId } },
          select: { name: true },
        });
        if (other) {
          return err({ kind: "accountHasOtherPlayer", playerName: other.name });
        }
        await tx.gameUser.update({
          where: { id: gameUserId },
          data: { userId },
        });
        return ok({ changed: true });
      },
    ),
  );
}

/** Players in a game that are saved to this account, for "Resume as …". */
export async function linkedPlayers({
  gameCode,
  userId,
}: {
  gameCode: string;
  userId: string;
}) {
  const players = await db.gameUser.findMany({
    where: { userId, removedAt: null, game: { code: gameCode.toUpperCase() } },
    orderBy: { index: "asc" },
    select: {
      id: true,
      name: true,
      game: { select: { name: true, format: true } },
      gameTeam: { select: { name: true } },
    },
  });
  return players.map((player) => ({
    gameUserId: player.id,
    nickname: player.name,
    gameName: player.game.name,
    teamName:
      player.game.format === GameFormat.team
        ? (player.gameTeam?.name ?? null)
        : null,
  }));
}

/**
 * Gives the signed-in account the credential of a player saved to it. The
 * player keeps the same credential, so their other devices keep working.
 */
export async function resumeLinkedPlayer({
  gameCode,
  gameUserId,
  userId,
}: {
  gameCode: string;
  gameUserId: string;
  userId: string;
}): Promise<
  Result<{ gameId: string; token: string; gameUser: GameUser }, IdentityError>
> {
  const player = await db.gameUser.findFirst({
    where: {
      id: gameUserId,
      userId,
      removedAt: null,
      game: { code: gameCode.toUpperCase() },
    },
  });
  if (!player) return err({ kind: "playerNotFound" });
  return ok({ gameId: player.gameId, token: player.token, gameUser: player });
}

/**
 * Creates a one-time link that lets a guest who lost their device get back
 * in as the same player. Staff verify the person first (for example in the
 * meeting). Earlier unused links for the same player stop working. Creating
 * a link does not cut off a device that still works; using it does.
 */
export async function createRecoveryLink({
  gameId,
  gameUserId,
  issuedById,
  now = new Date(),
}: {
  gameId: string;
  gameUserId: string;
  issuedById: string;
  now?: Date;
}): Promise<
  Result<{ token: string; expiresAt: Date; nickname: string }, IdentityError>
> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const player = await tx.gameUser.findFirst({
        where: { id: gameUserId, gameId, removedAt: null },
      });
      if (!player) return err<never, IdentityError>({ kind: "playerNotFound" });
      if (player.userId) {
        return err<never, IdentityError>({ kind: "playerLinked" });
      }

      await tx.gameInvite.updateMany({
        where: {
          gameId,
          purpose: InvitePurpose.guestRecovery,
          targetGameUserId: gameUserId,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      const token = generateToken();
      const expiresAt = new Date(
        now.getTime() + RECOVERY_LINK_LIFETIME_MINUTES * 60_000,
      );
      await tx.gameInvite.create({
        data: {
          gameId,
          tokenHash: hashToken(token),
          purpose: InvitePurpose.guestRecovery,
          targetGameUserId: gameUserId,
          issuedById,
          expiresAt,
        },
      });
      return ok({ token, expiresAt, nickname: player.name });
    }),
  );
}

type RecoveryStatus = "valid" | "used" | "revoked" | "expired";

async function findRecovery(token: string) {
  const invite = await db.gameInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { game: { select: { id: true, name: true } } },
  });
  return invite?.purpose === InvitePurpose.guestRecovery &&
    invite.targetGameUserId
    ? invite
    : null;
}

/** What a recovery link restores. Reading it never uses it. */
export async function previewRecovery({
  token,
  now = new Date(),
}: {
  token: string;
  now?: Date;
}) {
  const invite = await findRecovery(token);
  if (!invite) return null;
  const player = await db.gameUser.findFirst({
    where: { id: invite.targetGameUserId!, removedAt: null },
    select: { name: true },
  });
  const status: RecoveryStatus = invite.usedAt
    ? "used"
    : invite.revokedAt || !player
      ? "revoked"
      : invite.expiresAt <= now
        ? "expired"
        : "valid";
  return {
    gameId: invite.game.id,
    gameName: invite.game.name,
    nickname: player?.name ?? null,
    status,
  };
}

/**
 * Uses a recovery link once: the player gets a new credential and the old one
 * stops working everywhere. Name, team, points and locks are unchanged. A used
 * link cannot issue another credential; staff create a new link instead.
 */
export async function redeemRecovery({
  token,
  now = new Date(),
}: {
  token: string;
  now?: Date;
}): Promise<
  Result<{ gameId: string; token: string; gameUser: GameUser }, IdentityError>
> {
  const invite = await findRecovery(token);
  if (!invite) return err({ kind: "inviteNotFound" });

  return flatten(
    await withGameLock(invite.gameId, async (tx) => {
      const current = await tx.gameInvite.findUniqueOrThrow({
        where: { id: invite.id },
      });
      if (current.usedAt) {
        return err<never, IdentityError>({ kind: "inviteUsed" });
      }
      if (current.revokedAt) {
        return err<never, IdentityError>({ kind: "inviteRevoked" });
      }
      if (current.expiresAt <= now) {
        return err<never, IdentityError>({ kind: "inviteExpired" });
      }
      const player = await tx.gameUser.findFirst({
        where: {
          id: invite.targetGameUserId!,
          gameId: invite.gameId,
          removedAt: null,
        },
      });
      if (!player) {
        return err<never, IdentityError>({ kind: "playerNotFound" });
      }
      // Recheck: the player may have been saved to an account since.
      if (player.userId) {
        return err<never, IdentityError>({ kind: "playerLinked" });
      }

      const newToken = generateToken();
      const gameUser = await tx.gameUser.update({
        where: { id: player.id },
        data: { token: newToken },
      });
      await tx.gameInvite.update({
        where: { id: current.id },
        data: { usedAt: now },
      });
      return ok({ gameId: invite.gameId, token: newToken, gameUser });
    }),
  );
}
