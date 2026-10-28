import { Prisma, type PrismaClient } from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import { db as defaultDb } from "@/server/db";
import { logger } from "@/logger";

export type GameTx = Prisma.TransactionClient;

export type GameTransactionError =
  | { kind: "gameNotFound"; gameId: string }
  /** Lock wait, deadlock or serialization failure; safe for the client to retry. */
  | { kind: "busy"; gameId: string; cause: unknown };

const RETRYABLE_POSTGRES_CODES = new Set(["40001", "40P01", "55P03"]);

// Most game writes take a few milliseconds. These bound how long a burst of
// operations may queue (for a pooled connection, then for the game's row lock)
// before reporting "busy" instead of hanging the request.
const DEFAULT_MAX_WAIT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;

function postgresCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { code?: unknown } | undefined;
    if (typeof meta?.code === "string") return meta.code;
    if (error.code === "P2034") return "40001";
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\b(40001|40P01|55P03)\b/.exec(message)?.[1];
}

function isTransactionStartTimeout(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2028"
  );
}

/**
 * A transaction that failed only because the database was too busy (no
 * pooled connection in time, a lock wait, a deadlock or a serialization
 * conflict). Nothing was saved, and the request can safely be retried.
 */
export function isBusyError(error: unknown): boolean {
  const code = postgresCode(error);
  return (
    (!!code && RETRYABLE_POSTGRES_CODES.has(code)) ||
    isTransactionStartTimeout(error)
  );
}

class GameNotFound extends Error {}

/**
 * Runs `work` in one transaction that holds a row lock on the game.
 *
 * The lock is FOR NO KEY UPDATE: game writers still run one at a time, but
 * inserts into tables that reference the game (chat messages, buzz claims,
 * score effects), whose foreign-key checks take a key-share lock on the
 * game row, don't queue behind it. Deleting the game still excludes them.
 *
 * Writes that read and then replace shared game state (scores, buzzer, roster
 * revisions) must use this so concurrent requests for the same game run one
 * after another instead of overwriting each other or deadlocking. Requests for
 * different games do not wait for each other.
 *
 * Throwing inside `work` rolls back and the error propagates unchanged, so
 * domain errors (e.g. `TRPCError`) reach the caller. Lock contention and a
 * missing game are returned as `GameTransactionError` values; any other
 * database failure is rethrown rather than reported as success.
 */
export async function withGameLock<T>(
  gameId: string,
  work: (tx: GameTx) => Promise<T>,
  {
    client = defaultDb,
    maxWait = DEFAULT_MAX_WAIT_MS,
    timeout = DEFAULT_TIMEOUT_MS,
    lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    lockFirst = true,
  }: {
    client?: PrismaClient;
    maxWait?: number;
    timeout?: number;
    lockTimeoutMs?: number;
    /**
     * False when `work` takes the game row lock itself with its first write
     * (for example a conditional UPDATE), keeping the locked part short.
     */
    lockFirst?: boolean;
  } = {},
): Promise<Result<T, GameTransactionError>> {
  const lockTimeout = `${Math.max(1, Math.floor(lockTimeoutMs))}ms`;
  try {
    const value = await client.$transaction(
      async (tx) => {
        // Applies to this transaction only (including later locks in `work`).
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${lockTimeout}, true)`;
        if (lockFirst) {
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Game" WHERE id = ${gameId} FOR NO KEY UPDATE`;
          if (locked.length === 0) {
            throw new GameNotFound(gameId);
          }
        }
        return work(tx);
      },
      { maxWait, timeout },
    );
    return ok(value);
  } catch (error) {
    if (error instanceof GameNotFound) {
      return err({ kind: "gameNotFound", gameId });
    }
    if (isBusyError(error)) {
      logger.warn(
        `Game ${gameId} transaction busy`,
        postgresCode(error) ?? "start timeout",
      );
      return err({ kind: "busy", gameId, cause: error });
    }
    throw error;
  }
}

/**
 * Chat's own per-game lock, separate from the game row so chat sends never
 * queue behind buzzes or score changes (or hold them up). Sends take it
 * shared, so they don't wait for each other; changes that decide whether a
 * send is allowed (mute, finish, chat on/off, staff-only and slow mode) take
 * it exclusively, so no send can interleave with them.
 */
export async function lockChatGate(
  tx: GameTx,
  gameId: string,
  mode: "shared" | "exclusive",
) {
  const key = `chat:${gameId}`;
  if (mode === "shared") {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
  } else {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}
