import { createHash, randomInt } from "node:crypto";

import {
  BuzzerState,
  GameFormat,
  GameStatus,
  TeamAssignment,
} from "@prisma/client";
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
  { kind: "player"; gameUserId: string } | { kind: "staff" };

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
  | { kind: "hostAssignsTeams" }
  | { kind: "requestIdReused"; requestId: string }
  | {
      kind: "shuffleUnavailable";
      reason: "noTeams" | "noPlayers" | "activePlay";
    };

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

/** One confirmed shuffle and its optional switching lock commit together. */
export async function randomizeTeams({
  gameId,
  actorUserId,
  requestId,
  lockTeams,
}: {
  gameId: string;
  actorUserId: string;
  requestId: string;
  lockTeams: boolean;
}): Promise<Result<Changed, RosterError>> {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<Changed, RosterError>> => {
        const hash = createHash("sha256")
          .update(JSON.stringify({ lockTeams }))
          .digest("hex");
        const action = "roster.randomizeTeams";
        const existing = await tx.gameOperation.findUnique({
          where: { gameId_requestId: { gameId, requestId } },
        });
        if (existing) {
          if (
            existing.action !== action ||
            existing.actorUserId !== actorUserId ||
            existing.payloadHash !== hash
          ) {
            return err({ kind: "requestIdReused", requestId });
          }
          return ok({ changed: false });
        }

        const game = await loadGame(tx, gameId);
        if (game.format !== GameFormat.team)
          return err({ kind: "teamsNotSupported" });
        if (game.status === GameStatus.finished)
          return err({ kind: "gameFinished" });
        const teams = await tx.gameTeam.findMany({
          where: { gameId },
          orderBy: { index: "asc" },
          select: { id: true, buzzerState: true },
        });
        if (!teams.length)
          return err({ kind: "shuffleUnavailable", reason: "noTeams" });
        const mode = await tx.gameMode.findUnique({
          where: { gameId },
          select: { status: true },
        });
        if (
          game.isBuzzerListening ||
          teams.some((team) => team.buzzerState !== BuzzerState.available) ||
          mode?.status === "running"
        ) {
          return err({ kind: "shuffleUnavailable", reason: "activePlay" });
        }
        const players = await tx.gameUser.findMany({
          where: { gameId, removedAt: null },
          orderBy: { index: "asc" },
          select: { id: true },
        });
        if (!players.length)
          return err({ kind: "shuffleUnavailable", reason: "noPlayers" });

        // Shuffle teams too, so the same team does not always get the extra player.
        for (const items of [players, teams]) {
          for (let i = items.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [items[i], items[j]] = [items[j]!, items[i]!];
          }
        }
        for (const [index, team] of teams.entries()) {
          const ids = players
            .filter((_, i) => i % teams.length === index)
            .map((p) => p.id);
          if (ids.length) {
            await tx.gameUser.updateMany({
              where: { gameId, id: { in: ids }, removedAt: null },
              data: { gameTeamId: team.id },
            });
          }
        }
        await repairCaptains(tx, gameId);
        await tx.game.update({
          where: { id: gameId },
          data: {
            updatedAt: new Date(),
            ...(lockTeams
              ? {
                  settings: {
                    ...(game.settings as GameSettings),
                    freezeTeams: true,
                  },
                }
              : {}),
          },
        });
        await tx.gameOperation.create({
          data: {
            gameId,
            actorUserId,
            requestId,
            action,
            payloadHash: hash,
            result: {},
          },
        });
        return ok({ changed: true });
      },
    ),
  );
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
