import {
  BuzzerState,
  GameStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import { db as defaultDb } from "@/server/db";
import {
  withGameLock,
  type GameTransactionError,
  type GameTx,
} from "@/server/db/gameTransaction";

export type BuzzOutcome = {
  /** True when this participant's team holds the buzz for the open window. */
  accepted: boolean;
  /** True when the request had already been accepted and nothing changed. */
  replayed: boolean;
};

export type BuzzError =
  | GameTransactionError
  | { kind: "participantNotFound" }
  | { kind: "notOnTeam" }
  | { kind: "notListening" }
  | { kind: "gameFinished" }
  | { kind: "teamRejected" }
  | { kind: "requestIdReused" };

export type BuzzWinner = {
  /** Null only for a team selected before claims were recorded (pre-PR04). */
  gameUserId: string | null;
  gameTeamId: string;
};

export type BuzzerControlError =
  | GameTransactionError
  | { kind: "gameFinished" };

/**
 * Opens the buzzer: the previous winner becomes rejected and a new window
 * starts. Opening the buzzer in the lobby starts the game.
 */
export async function openBuzzer(
  gameId: string,
): Promise<Result<{ changed: boolean }, BuzzerControlError>> {
  const outcome = await withGameLock(
    gameId,
    async (tx): Promise<Result<{ changed: boolean }, BuzzerControlError>> => {
      const game = await tx.game.findUniqueOrThrow({ where: { id: gameId } });
      if (game.status === GameStatus.finished) {
        return err({ kind: "gameFinished" });
      }
      if (game.isBuzzerListening) return ok({ changed: false });

      await tx.gameTeam.updateMany({
        where: { gameId, buzzerState: BuzzerState.selected },
        data: { buzzerState: BuzzerState.rejected },
      });
      await tx.game.update({
        where: { id: gameId },
        data: {
          isBuzzerListening: true,
          buzzerWindow: { increment: 1 },
          status: GameStatus.running,
        },
      });
      return ok({ changed: true });
    },
  );
  return outcome.isErr() ? err(outcome.error) : outcome.value;
}

export function pauseBuzzer(gameId: string) {
  return withGameLock(gameId, async (tx) => {
    const { count } = await tx.game.updateMany({
      where: { id: gameId, isBuzzerListening: true },
      data: { isBuzzerListening: false },
    });
    return { changed: count > 0 };
  });
}

/** Clears every team's buzzer state and the current winner, and stops listening. */
export function resetBuzzer(gameId: string) {
  return withGameLock(gameId, async (tx) => {
    await tx.gameTeam.updateMany({
      where: { gameId },
      data: { buzzerState: BuzzerState.available },
    });
    await tx.game.update({
      where: { id: gameId },
      data: { isBuzzerListening: false, buzzerWindow: { increment: 1 } },
    });
    return { changed: true };
  });
}

/**
 * Accepts at most one buzz per open window. The claim, the team's `selected`
 * state and closing the window commit together, and the (game, window)
 * uniqueness constraint backs it up, so there can only be one winner.
 *
 * Buzzes that can't win are answered from committed state without any lock
 * (settledOutcome). The rest race on one conditional UPDATE that closes the
 * window: exactly one matches; the others match nothing once it commits and
 * get the same answers a losing buzz always got.
 */
export async function buzzIn({
  gameId,
  gameUserId,
  requestId,
}: {
  gameId: string;
  gameUserId: string;
  requestId?: string;
}): Promise<Result<BuzzOutcome, BuzzError>> {
  const settled = await settledOutcome({ gameId, gameUserId, requestId });
  if (settled) return settled;

  const gameUser = await defaultDb.gameUser.findFirst({
    where: { id: gameUserId, gameId },
    select: { gameTeamId: true },
  });
  if (!gameUser) return err({ kind: "participantNotFound" });
  if (!gameUser.gameTeamId) return err({ kind: "notOnTeam" });
  const gameTeamId = gameUser.gameTeamId;

  const outcome = await withGameLock(
    gameId,
    async (tx): Promise<Result<BuzzOutcome, BuzzError> | null> => {
      // Closing the window is the claim's first statement and takes the game
      // row lock. When everyone buzzes at once, the others wait only for
      // this short transaction, then match no row and answer straight away.
      const closed = await tx.$queryRaw<{ buzzerWindow: number }[]>`
        UPDATE "Game" SET "isBuzzerListening" = false
        WHERE id = ${gameId} AND "isBuzzerListening"
          AND status <> 'finished'::"GameStatus"
        RETURNING "buzzerWindow"`;
      if (closed.length === 0) return null;

      // Re-read under the lock: the host may have reopened the buzzer (which
      // rejects the previous winner's team) since the checks above.
      const team = await tx.gameTeam.findFirst({
        where: { id: gameTeamId, gameId },
        select: { buzzerState: true },
      });
      if (!team) throw new BuzzRejected({ kind: "notOnTeam" });
      if (team.buzzerState === BuzzerState.rejected) {
        throw new BuzzRejected({ kind: "teamRejected" });
      }
      await tx.buzzClaim.create({
        data: {
          gameId,
          window: closed[0]!.buzzerWindow,
          gameUserId,
          gameTeamId,
          requestId,
        },
      });
      await tx.gameTeam.update({
        where: { id: gameTeamId },
        data: { buzzerState: BuzzerState.selected },
      });
      return ok({ accepted: true, replayed: false });
    },
    { lockFirst: false },
  ).catch((error: unknown) => {
    if (error instanceof BuzzRejected) return ok(err(error.reason));
    if (isUniqueViolation(error)) return ok(null);
    throw error;
  });
  if (outcome.isErr()) return err(outcome.error);
  if (outcome.value) return outcome.value;
  // The window was already closed, or a retry of this request raced it:
  // answer from committed state, as for any losing buzz.
  return (
    (await settledOutcome({ gameId, gameUserId, requestId })) ??
    err({ kind: "notListening" })
  );
}

/** Rolls back the claim transaction with a domain answer. */
class BuzzRejected extends Error {
  constructor(readonly reason: BuzzError) {
    super(reason.kind);
  }
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Answers a buzz without the game lock when committed state already decides
 * it: a retried claim, a team that already holds or lost the buzz, a
 * finished game, or a closed buzzer. These are the same answers the locked
 * path gives for a request that arrived at that moment. When everyone buzzes
 * at once, only attempts that could still win wait for the lock. Returns
 * null when the locked path must decide.
 */
async function settledOutcome({
  gameId,
  gameUserId,
  requestId,
}: {
  gameId: string;
  gameUserId: string;
  requestId?: string;
}): Promise<Result<BuzzOutcome, BuzzError> | null> {
  if (requestId) {
    const previous = await defaultDb.buzzClaim.findUnique({
      where: { gameId_requestId: { gameId, requestId } },
    });
    if (previous) {
      return previous.gameUserId === gameUserId
        ? ok({ accepted: true, replayed: true })
        : err({ kind: "requestIdReused" });
    }
  }
  const gameUser = await defaultDb.gameUser.findFirst({
    where: { id: gameUserId, gameId },
    select: {
      gameTeam: { select: { buzzerState: true } },
      game: { select: { status: true, isBuzzerListening: true } },
    },
  });
  if (!gameUser?.gameTeam) return null;
  if (gameUser.gameTeam.buzzerState === BuzzerState.rejected) {
    return err({ kind: "teamRejected" });
  }
  if (gameUser.gameTeam.buzzerState === BuzzerState.selected) {
    return ok({ accepted: true, replayed: true });
  }
  if (gameUser.game.status === GameStatus.finished) {
    return err({ kind: "gameFinished" });
  }
  if (!gameUser.game.isBuzzerListening) return err({ kind: "notListening" });
  return null;
}

/**
 * The current window's winner, read from PostgreSQL. A `selected` team without
 * a claim can only come from before PR04; it is reported with an unknown
 * participant rather than hidden.
 */
export async function getBuzzWinner(
  gameId: string,
  client: PrismaClient | GameTx = defaultDb,
): Promise<BuzzWinner | null> {
  const game = await client.game.findUnique({
    where: { id: gameId },
    select: { buzzerWindow: true },
  });
  if (!game) return null;

  const current = await client.buzzClaim.findUnique({
    where: { gameId_window: { gameId, window: game.buzzerWindow } },
  });
  if (current) {
    return { gameUserId: current.gameUserId, gameTeamId: current.gameTeamId };
  }

  const legacySelected = await client.gameTeam.findFirst({
    where: { gameId, buzzerState: BuzzerState.selected },
    select: { id: true },
  });
  return legacySelected
    ? { gameUserId: null, gameTeamId: legacySelected.id }
    : null;
}
