import { GameFormat, GameStatus, TeamAssignment } from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import {
  withGameLock,
  type GameTransactionError,
  type GameTx,
} from "@/server/db/gameTransaction";
import { releaseTeamsFromQueue } from "@/server/buzzer/buzzerService";
import { repairCaptains } from "@/server/roster/captains";
import { generateToken } from "@/server/utils/codeGeneration";
import { normalizeName, type NameError } from "@/utils/displayName";
import type { GameSettings } from "@/types";

/** Who is making a roster change. Staff authority is checked by the router. */
export type RosterActor =
  | { kind: "player"; gameUserId: string }
  | { kind: "staff" };

export type RosterError =
  | GameTransactionError
  | { kind: "gameFinished" }
  | { kind: "playerNotFound" }
  | { kind: "teamNotFound" }
  | { kind: "teamsNotSupported" }
  | { kind: "invalidName"; field: "nickname" | "team"; error: NameError }
  | { kind: "renameLocked"; target: "player" | "team" }
  /** The name changed since the editor loaded it; their draft is kept. */
  | { kind: "nameChanged" }
  | { kind: "notTeamMember" }
  | { kind: "buzzerOpen" }
  | { kind: "teamSwitchingOff" }
  | { kind: "hostAssignsTeams" };

type Changed = { changed: boolean };

function flatten<T>(
  result: Result<Result<T, RosterError>, GameTransactionError>,
): Result<T, RosterError> {
  return result.isErr() ? err(result.error) : result.value;
}

async function loadGame(tx: GameTx, gameId: string) {
  return tx.game.findUniqueOrThrow({ where: { id: gameId } });
}

async function activePlayer(tx: GameTx, gameId: string, gameUserId: string) {
  return tx.gameUser.findFirst({
    where: { id: gameUserId, gameId, removedAt: null },
  });
}

/**
 * Renames a player. Players rename themselves only while their renaming is
 * unlocked and the game is not finished. Staff can always rename, including
 * after finish, and can lock or unlock self-renaming in the same save.
 */
export async function renamePlayer({
  gameId,
  gameUserId,
  name,
  actor,
  expectedNameVersion,
  allowSelfRename,
}: {
  gameId: string;
  gameUserId: string;
  name?: string;
  actor: RosterActor;
  expectedNameVersion?: number;
  /** Staff only: set the player's own-rename permission in the same save. */
  allowSelfRename?: boolean;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (
        tx,
      ): Promise<
        Result<Changed & { name: string; nameVersion: number }, RosterError>
      > => {
        const game = await loadGame(tx, gameId);
        const player = await activePlayer(tx, gameId, gameUserId);
        if (!player) return err({ kind: "playerNotFound" });

        if (actor.kind === "player") {
          if (actor.gameUserId !== gameUserId) {
            return err({ kind: "playerNotFound" });
          }
          if (game.status === GameStatus.finished) {
            return err({ kind: "gameFinished" });
          }
          if (!player.allowSelfRename) {
            return err({ kind: "renameLocked", target: "player" });
          }
        }
        if (
          expectedNameVersion !== undefined &&
          expectedNameVersion !== player.nameVersion
        ) {
          return err({ kind: "nameChanged" });
        }

        let nextName = player.name;
        if (name !== undefined) {
          const normalized = normalizeName(name);
          if (normalized.isErr()) {
            return err({
              kind: "invalidName",
              field: "nickname",
              error: normalized.error,
            });
          }
          nextName = normalized.value;
        }
        const lockChange =
          actor.kind === "staff" &&
          allowSelfRename !== undefined &&
          allowSelfRename !== player.allowSelfRename;
        const nameChange = nextName !== player.name;
        if (!nameChange && !lockChange) {
          return ok({
            changed: false,
            name: player.name,
            nameVersion: player.nameVersion,
          });
        }

        const updated = await tx.gameUser.update({
          where: { id: gameUserId },
          data: {
            name: nextName,
            nameVersion: nameChange ? { increment: 1 } : undefined,
            allowSelfRename: lockChange ? allowSelfRename : undefined,
          },
        });
        // An individual player's scoring unit is shown under their name.
        if (
          nameChange &&
          game.format === GameFormat.individual &&
          player.gameTeamId
        ) {
          await tx.gameTeam.update({
            where: { id: player.gameTeamId },
            data: { name: nextName, nameVersion: { increment: 1 } },
          });
        }
        return ok({
          changed: true,
          name: updated.name,
          nameVersion: updated.nameVersion,
        });
      },
    ),
  );
}

/**
 * Renames a team. Members rename their own team while member renaming is
 * unlocked; staff can rename any team and lock or unlock member renaming.
 * Individual games have no team names to edit.
 */
export async function renameTeam({
  gameId,
  gameTeamId,
  name,
  actor,
  expectedNameVersion,
  allowMemberRename,
}: {
  gameId: string;
  gameTeamId: string;
  name?: string;
  actor: RosterActor;
  expectedNameVersion?: number;
  allowMemberRename?: boolean;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (
        tx,
      ): Promise<
        Result<Changed & { name: string; nameVersion: number }, RosterError>
      > => {
        const game = await loadGame(tx, gameId);
        if (game.format !== GameFormat.team) {
          return err({ kind: "teamsNotSupported" });
        }
        const team = await tx.gameTeam.findFirst({
          where: { id: gameTeamId, gameId },
        });
        if (!team) return err({ kind: "teamNotFound" });

        if (actor.kind === "player") {
          const player = await activePlayer(tx, gameId, actor.gameUserId);
          if (player?.gameTeamId !== gameTeamId) {
            return err({ kind: "notTeamMember" });
          }
          if (game.status === GameStatus.finished) {
            return err({ kind: "gameFinished" });
          }
          if (!team.allowMemberRename) {
            return err({ kind: "renameLocked", target: "team" });
          }
        }
        if (
          expectedNameVersion !== undefined &&
          expectedNameVersion !== team.nameVersion
        ) {
          return err({ kind: "nameChanged" });
        }

        let nextName = team.name;
        if (name !== undefined) {
          const normalized = normalizeName(name);
          if (normalized.isErr()) {
            return err({
              kind: "invalidName",
              field: "team",
              error: normalized.error,
            });
          }
          nextName = normalized.value;
        }
        const lockChange =
          actor.kind === "staff" &&
          allowMemberRename !== undefined &&
          allowMemberRename !== team.allowMemberRename;
        const nameChange = nextName !== team.name;
        if (!nameChange && !lockChange) {
          return ok({
            changed: false,
            name: team.name,
            nameVersion: team.nameVersion,
          });
        }

        const updated = await tx.gameTeam.update({
          where: { id: gameTeamId },
          data: {
            name: nextName,
            nameVersion: nameChange ? { increment: 1 } : undefined,
            allowMemberRename: lockChange ? allowMemberRename : undefined,
          },
        });
        return ok({
          changed: true,
          name: updated.name,
          nameVersion: updated.nameVersion,
        });
      },
    ),
  );
}

/**
 * Moves a player to another team (or, for staff, to no team). Points stay
 * with the team that earned them. Moves wait while the buzzer is open, for
 * players and staff alike, so a move can't change who is eligible mid-buzz.
 */
export async function movePlayer({
  gameId,
  gameUserId,
  targetGameTeamId,
  actor,
}: {
  gameId: string;
  gameUserId: string;
  targetGameTeamId: string | null;
  actor: RosterActor;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<Changed, RosterError>> => {
        const game = await loadGame(tx, gameId);
        if (game.format !== GameFormat.team) {
          return err({ kind: "teamsNotSupported" });
        }
        const player = await activePlayer(tx, gameId, gameUserId);
        if (!player) return err({ kind: "playerNotFound" });

        if (actor.kind === "player") {
          if (actor.gameUserId !== gameUserId || targetGameTeamId === null) {
            return err({ kind: "playerNotFound" });
          }
          if (player.gameTeamId === targetGameTeamId) {
            return ok({ changed: false });
          }
          if (game.status === GameStatus.finished) {
            return err({ kind: "gameFinished" });
          }
          if (game.teamAssignment === TeamAssignment.staff) {
            return err({ kind: "hostAssignsTeams" });
          }
          if ((game.settings as GameSettings | null)?.freezeTeams) {
            return err({ kind: "teamSwitchingOff" });
          }
        }
        if (player.gameTeamId === targetGameTeamId) {
          return ok({ changed: false });
        }
        if (game.isBuzzerListening) return err({ kind: "buzzerOpen" });

        if (targetGameTeamId !== null) {
          const team = await tx.gameTeam.findFirst({
            where: { id: targetGameTeamId, gameId },
            select: { id: true },
          });
          if (!team) return err({ kind: "teamNotFound" });
        }
        await tx.gameUser.update({
          where: { id: gameUserId },
          data: { gameTeamId: targetGameTeamId },
        });
        await repairCaptains(tx, gameId);
        return ok({ changed: true });
      },
    ),
  );
}

/**
 * Removes a player at once, even while the buzzer is open. Their credential
 * stops working (it is replaced with one nobody has), they disappear from the
 * roster, and they can't be recovered. A buzz they already won and points
 * their team earned stay.
 */
export async function removePlayer({
  gameId,
  gameUserId,
  now = new Date(),
}: {
  gameId: string;
  gameUserId: string;
  now?: Date;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<Changed, RosterError>> => {
        const player = await tx.gameUser.findFirst({
          where: { id: gameUserId, gameId },
        });
        if (!player) return err({ kind: "playerNotFound" });
        if (player.removedAt) return ok({ changed: false });
        await tx.gameUser.update({
          where: { id: gameUserId },
          data: { removedAt: now, token: generateToken() },
        });
        // In individual games the player is their own team: a removed
        // player can't answer, so their place in the buzz queue is skipped.
        const game = await tx.game.findUniqueOrThrow({
          where: { id: gameId },
          select: { format: true },
        });
        if (game.format === GameFormat.individual && player.gameTeamId) {
          await releaseTeamsFromQueue(tx, gameId, [player.gameTeamId]);
        }
        await repairCaptains(tx, gameId);
        return ok({ changed: true });
      },
    ),
  );
}
