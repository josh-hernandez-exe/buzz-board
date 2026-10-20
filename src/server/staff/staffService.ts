import { createHash } from "node:crypto";

import {
  InvitePurpose,
  StaffRole,
  type GameAdmin,
  type GameInvite,
} from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import { db } from "@/server/db";
import {
  withGameLock,
  type GameTransactionError,
} from "@/server/db/gameTransaction";
import { generateToken } from "@/server/utils/codeGeneration";
import {
  INVITE_LIFETIME_HOURS,
  ROLE_RANK,
  type InvitableRole,
  type StaffRoleName,
} from "@/utils/capabilities";

export type StaffError =
  | GameTransactionError
  | { kind: "inviteNotFound" }
  | { kind: "inviteUsed" }
  | { kind: "inviteRevoked" }
  | { kind: "inviteExpired" }
  | { kind: "cannotChangeOwner" }
  | { kind: "staffNotFound" };

export const toStoredRole = (role: InvitableRole): StaffRole =>
  role === "cohost" ? StaffRole.admin : StaffRole.moderator;

const fromStoredRole = (role: StaffRole): Exclude<StaffRoleName, "owner"> =>
  role === StaffRole.admin ? "cohost" : "moderator";

/** The owner is derived from the game's creator, never from a stored role. */
export function staffRoleFor({
  createdById,
  gameAdmin,
  userId,
}: {
  createdById: string;
  gameAdmin: Pick<GameAdmin, "role" | "userId"> | null | undefined;
  userId: string | null | undefined;
}): StaffRoleName | null {
  if (!userId) return null;
  if (createdById === userId) return "owner";
  if (gameAdmin?.userId !== userId) return null;
  return fromStoredRole(gameAdmin.role);
}

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function flatten<T>(
  result: Result<Result<T, StaffError>, GameTransactionError>,
): Result<T, StaffError> {
  return result.isErr() ? err(result.error) : result.value;
}

export async function createStaffInvite({
  gameId,
  issuedById,
  role,
  now = new Date(),
}: {
  gameId: string;
  issuedById: string;
  role: InvitableRole;
  now?: Date;
}) {
  const token = generateToken();
  const invite = await db.gameInvite.create({
    data: {
      gameId,
      tokenHash: hashToken(token),
      purpose: InvitePurpose.staff,
      role: toStoredRole(role),
      issuedById,
      expiresAt: new Date(now.getTime() + INVITE_LIFETIME_HOURS * 3_600_000),
    },
  });
  return { token, invite };
}

type InviteStatus = "valid" | "used" | "revoked" | "expired";

function statusOf(invite: GameInvite, now: Date): InviteStatus {
  if (invite.usedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt <= now) return "expired";
  return "valid";
}

/**
 * What a staff invitation offers, for the page shown before accepting.
 * Reading it never consumes the invitation.
 */
export async function previewStaffInvite({
  token,
  userId,
  now = new Date(),
}: {
  token: string;
  userId?: string;
  now?: Date;
}) {
  const invite = await db.gameInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      game: { select: { id: true, name: true, createdById: true } },
    },
  });
  if (invite?.purpose !== InvitePurpose.staff || !invite.role) return null;

  let currentRole: StaffRoleName | null = null;
  if (userId) {
    const gameAdmin = await db.gameAdmin.findUnique({
      where: { userId_gameId: { userId, gameId: invite.gameId } },
    });
    currentRole = staffRoleFor({
      createdById: invite.game.createdById,
      gameAdmin,
      userId,
    });
  }
  return {
    gameId: invite.game.id,
    gameName: invite.game.name,
    role: fromStoredRole(invite.role),
    status: statusOf(invite, now),
    expiresAt: invite.expiresAt,
    usedBySelf: !!userId && invite.usedById === userId,
    currentRole,
  };
}

export type AcceptResult = {
  gameId: string;
  /** The account's role in the game after accepting. */
  role: StaffRoleName;
  /** True when this request changed membership. */
  changed: boolean;
};

/**
 * Redeems a staff invitation for a signed-in account, once.
 *
 * - The same account retrying a used invitation gets its current status;
 *   membership removed since is not restored.
 * - An existing equal or higher role is kept, never lowered.
 * - The owner's own acceptance changes nothing and leaves the link unused.
 */
export async function acceptStaffInvite({
  token,
  userId,
  now = new Date(),
}: {
  token: string;
  userId: string;
  now?: Date;
}): Promise<Result<AcceptResult, StaffError>> {
  const invite = await db.gameInvite.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (invite?.purpose !== InvitePurpose.staff || !invite.role) {
    return err({ kind: "inviteNotFound" });
  }
  const inviteRole = invite.role;

  return flatten(
    await withGameLock(
      invite.gameId,
      async (tx): Promise<Result<AcceptResult, StaffError>> => {
        const current = await tx.gameInvite.findUniqueOrThrow({
          where: { id: invite.id },
        });
        const game = await tx.game.findUniqueOrThrow({
          where: { id: invite.gameId },
          select: { id: true, createdById: true },
        });
        const existing = await tx.gameAdmin.findUnique({
          where: { userId_gameId: { userId, gameId: game.id } },
        });
        const currentRole = staffRoleFor({
          createdById: game.createdById,
          gameAdmin: existing,
          userId,
        });

        const status = statusOf(current, now);
        if (status === "used") {
          if (current.usedById !== userId) return err({ kind: "inviteUsed" });
          if (!currentRole) return err({ kind: "inviteUsed" });
          return ok({ gameId: game.id, role: currentRole, changed: false });
        }
        if (status === "revoked") return err({ kind: "inviteRevoked" });
        if (status === "expired") return err({ kind: "inviteExpired" });

        if (currentRole === "owner") {
          return ok({ gameId: game.id, role: "owner", changed: false });
        }

        const offered = fromStoredRole(inviteRole);
        const keepCurrent =
          !!currentRole && ROLE_RANK[currentRole] >= ROLE_RANK[offered];
        if (!keepCurrent) {
          await tx.gameAdmin.upsert({
            where: { userId_gameId: { userId, gameId: game.id } },
            create: { userId, gameId: game.id, role: inviteRole },
            update: { role: inviteRole },
          });
        }
        await tx.gameInvite.update({
          where: { id: current.id },
          data: { usedAt: now, usedById: userId },
        });
        return ok({
          gameId: game.id,
          role: keepCurrent ? currentRole : offered,
          changed: !keepCurrent,
        });
      },
    ),
  );
}

export async function listStaff(gameId: string, now = new Date()) {
  const game = await db.game.findUniqueOrThrow({
    where: { id: gameId },
    select: {
      createdById: true,
      createdBy: { select: { id: true, name: true } },
      gameAdmins: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          userId: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      },
      invites: {
        where: {
          purpose: InvitePurpose.staff,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, role: true, expiresAt: true, createdAt: true },
      },
    },
  });

  const helpers = game.gameAdmins
    .filter((admin) => admin.userId !== game.createdById)
    .map((admin) => ({
      gameAdminId: admin.id,
      userId: admin.userId,
      name: admin.user.name ?? "Organizer",
      role: fromStoredRole(admin.role),
    }));

  return {
    owner: {
      userId: game.createdById,
      name: game.createdBy.name ?? "Organizer",
    },
    helpers,
    pendingInvites: game.invites.map((invite) => ({
      inviteId: invite.id,
      role: invite.role ? fromStoredRole(invite.role) : "moderator",
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    })),
  };
}

async function findHelper(
  tx: Parameters<Parameters<typeof withGameLock>[1]>[0],
  gameId: string,
  gameAdminId: string,
): Promise<Result<GameAdmin, StaffError>> {
  const [game, target] = await Promise.all([
    tx.game.findUniqueOrThrow({
      where: { id: gameId },
      select: { createdById: true },
    }),
    tx.gameAdmin.findFirst({ where: { id: gameAdminId, gameId } }),
  ]);
  if (!target) return err({ kind: "staffNotFound" });
  if (target.userId === game.createdById) {
    return err({ kind: "cannotChangeOwner" });
  }
  return ok(target);
}

export async function setStaffRole({
  gameId,
  gameAdminId,
  role,
}: {
  gameId: string;
  gameAdminId: string;
  role: InvitableRole;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<{ changed: boolean }, StaffError>> => {
        const target = await findHelper(tx, gameId, gameAdminId);
        if (target.isErr()) return err(target.error);
        if (target.value.role === toStoredRole(role)) {
          return ok({ changed: false });
        }
        await tx.gameAdmin.update({
          where: { id: gameAdminId },
          data: { role: toStoredRole(role) },
        });
        return ok({ changed: true });
      },
    ),
  );
}

/** Removes a helper's role at once. Never applies to the owner. */
export async function removeStaff({
  gameId,
  gameAdminId,
}: {
  gameId: string;
  gameAdminId: string;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<{ changed: boolean }, StaffError>> => {
        const target = await findHelper(tx, gameId, gameAdminId);
        if (target.isErr()) return err(target.error);
        await tx.gameAdmin.delete({ where: { id: gameAdminId } });
        return ok({ changed: true });
      },
    ),
  );
}

export async function revokeInvite({
  gameId,
  inviteId,
  now = new Date(),
}: {
  gameId: string;
  inviteId: string;
  now?: Date;
}): Promise<Result<{ changed: boolean }, StaffError>> {
  const { count } = await db.gameInvite.updateMany({
    where: { id: inviteId, gameId, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  if (count > 0) return ok({ changed: true });
  const exists = await db.gameInvite.count({ where: { id: inviteId, gameId } });
  return exists ? ok({ changed: false }) : err({ kind: "inviteNotFound" });
}

/** Whether an account still has any staff role in a game. */
export async function isStillStaff(gameId: string, userId: string) {
  const game = await db.game.findUnique({
    where: { id: gameId },
    select: {
      createdById: true,
      gameAdmins: { where: { userId }, select: { id: true } },
    },
  });
  return !!game && (game.createdById === userId || game.gameAdmins.length > 0);
}
