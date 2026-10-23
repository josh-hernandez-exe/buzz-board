/**
 * Team captains. Every team with members always has a captain: the
 * earliest-joined current member, until staff or the captain hand the role
 * to someone else. Captains only matter when the game is captains-only;
 * they are kept up to date regardless, so switching the rule on is instant.
 */
import { GameFormat } from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import {
  withGameLock,
  type GameTransactionError,
  type GameTx,
} from "@/server/db/gameTransaction";

export type CaptainError =
  | GameTransactionError
  | { kind: "teamsNotSupported" }
  | { kind: "teamNotFound" }
  | { kind: "playerNotFound" }
  | { kind: "notTeamMember" }
  | { kind: "notCaptain" };

/**
 * Makes every team's captain a current member of it: a captain who left,
 * moved or was removed is replaced by the earliest-joined member left (or
 * nobody, for an empty team). Call under the game lock after any change to
 * who is on which team.
 */
export async function repairCaptains(tx: GameTx, gameId: string) {
  const game = await tx.game.findUniqueOrThrow({
    where: { id: gameId },
    select: { format: true },
  });
  if (game.format !== GameFormat.team) return;
  const teams = await tx.gameTeam.findMany({
    where: { gameId },
    select: {
      id: true,
      captainId: true,
      captain: { select: { gameTeamId: true, removedAt: true } },
    },
  });
  const valid = (t: (typeof teams)[number]) =>
    !!t.captain && t.captain.gameTeamId === t.id && !t.captain.removedAt;
  const broken = teams.filter((t) => !valid(t));
  if (broken.length === 0) return;
  // Clear first: a player who moved may still be the old team's captain,
  // and a captain can lead only one team.
  const stale = broken.filter((t) => t.captainId).map((t) => t.id);
  if (stale.length > 0) {
    await tx.gameTeam.updateMany({
      where: { id: { in: stale } },
      data: { captainId: null },
    });
  }
  for (const team of broken) {
    const first = await tx.gameUser.findFirst({
      where: { gameTeamId: team.id, removedAt: null },
      orderBy: [{ index: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (first) {
      await tx.gameTeam.update({
        where: { id: team.id },
        data: { captainId: first.id },
      });
    }
  }
}

/**
 * Hands a team's captaincy to one of its members. Staff can choose any
 * member; a player can hand it on only while they are the captain.
 */
export async function setCaptain({
  gameId,
  gameUserId,
  actor,
}: {
  gameId: string;
  gameUserId: string;
  actor: { kind: "staff" } | { kind: "player"; gameUserId: string };
}): Promise<Result<{ changed: boolean }, CaptainError>> {
  const outcome = await withGameLock(
    gameId,
    async (tx): Promise<Result<{ changed: boolean }, CaptainError>> => {
      const game = await tx.game.findUniqueOrThrow({
        where: { id: gameId },
        select: { format: true },
      });
      if (game.format !== GameFormat.team) {
        return err({ kind: "teamsNotSupported" });
      }
      await repairCaptains(tx, gameId);
      const player = await tx.gameUser.findFirst({
        where: { id: gameUserId, gameId, removedAt: null },
        select: { gameTeamId: true },
      });
      if (!player) return err({ kind: "playerNotFound" });
      if (!player.gameTeamId) return err({ kind: "notTeamMember" });
      const team = await tx.gameTeam.findUniqueOrThrow({
        where: { id: player.gameTeamId },
        select: { id: true, captainId: true },
      });
      if (actor.kind === "player" && team.captainId !== actor.gameUserId) {
        return err({ kind: "notCaptain" });
      }
      if (team.captainId === gameUserId) return ok({ changed: false });
      await tx.gameTeam.update({
        where: { id: team.id },
        data: { captainId: gameUserId },
      });
      return ok({ changed: true });
    },
  );
  return outcome.isErr() ? err(outcome.error) : outcome.value;
}

/** Turns the captains-only rule on or off (team games only). */
export async function setCaptainsOnly(
  gameId: string,
  captainsOnly: boolean,
): Promise<Result<{ changed: boolean }, CaptainError>> {
  const outcome = await withGameLock(
    gameId,
    async (tx): Promise<Result<{ changed: boolean }, CaptainError>> => {
      const game = await tx.game.findUniqueOrThrow({
        where: { id: gameId },
        select: { format: true, captainsOnly: true },
      });
      if (game.format !== GameFormat.team) {
        return err({ kind: "teamsNotSupported" });
      }
      if (game.captainsOnly === captainsOnly) return ok({ changed: false });
      await repairCaptains(tx, gameId);
      await tx.game.update({ where: { id: gameId }, data: { captainsOnly } });
      return ok({ changed: true });
    },
  );
  return outcome.isErr() ? err(outcome.error) : outcome.value;
}

/**
 * Whether this player may buzz or save answers for their team: always,
 * unless the game is captains-only and someone else captains the team.
 */
export function mayActForTeam(
  game: { format: GameFormat; captainsOnly: boolean },
  team: { captainId: string | null },
  gameUserId: string,
) {
  return (
    game.format !== GameFormat.team ||
    !game.captainsOnly ||
    // A team without a captain (no members yet) never locks anyone out.
    team.captainId === null ||
    team.captainId === gameUserId
  );
}
