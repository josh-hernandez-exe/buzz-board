import {
  BuzzerMode,
  BuzzerState,
  BuzzQueueStatus,
  GameFormat,
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

/**
 * The buzzer. Two modes (docs/buzzer-queue-and-history.md):
 * - first (default): the first buzz in a question wins and closes it.
 * - queue: every team that buzzes queues in order; the host works through
 *   the queue (correct, wrong, skip).
 * Every host action is recorded so it can be undone and redone.
 */

export type BuzzOutcome = {
  /** True when this participant's team holds (or has joined) the buzz. */
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
  | { kind: "gameFinished" }
  | { kind: "queueEntryNotFound" }
  | { kind: "queueEntryNotActive" }
  | { kind: "buzzerOpenModeChange" }
  | { kind: "nothingToUndoBuzzer" }
  | { kind: "nothingToRedoBuzzer" };

type Changed = { changed: boolean };

// ------------------------------------------------------------- history

/** Everything a host buzzer action can change, for undo and redo. */
export type BuzzerSnapshot = {
  listening: boolean;
  window: number;
  mode: BuzzerMode;
  teams: Record<string, BuzzerState>;
  /** Status of each queue entry in `window`. */
  queue: Record<string, BuzzQueueStatus>;
};

export type BuzzerHistoryEntry = {
  label: string;
  at: string;
  snapshot: BuzzerSnapshot;
};

/** Undo goes back at most this many actions. */
export const BUZZER_HISTORY_LIMIT = 50;

async function takeSnapshot(
  tx: GameTx,
  gameId: string,
): Promise<BuzzerSnapshot> {
  const game = await tx.game.findUniqueOrThrow({
    where: { id: gameId },
    select: { isBuzzerListening: true, buzzerWindow: true, buzzerMode: true },
  });
  const [teams, queue] = await Promise.all([
    tx.gameTeam.findMany({
      where: { gameId },
      select: { id: true, buzzerState: true },
    }),
    tx.buzzQueueEntry.findMany({
      where: { gameId, window: game.buzzerWindow },
      select: { id: true, status: true },
    }),
  ]);
  return {
    listening: game.isBuzzerListening,
    window: game.buzzerWindow,
    mode: game.buzzerMode,
    teams: Object.fromEntries(teams.map((t) => [t.id, t.buzzerState])),
    queue: Object.fromEntries(queue.map((q) => [q.id, q.status])),
  };
}

/**
 * Restores a snapshot. Teams added since go back to available; queue
 * entries made since (players' buzzes) keep their status, so undoing a host
 * action never loses a buzz.
 */
async function applySnapshot(tx: GameTx, gameId: string, snap: BuzzerSnapshot) {
  await tx.game.update({
    where: { id: gameId },
    data: {
      isBuzzerListening: snap.listening,
      buzzerWindow: snap.window,
      buzzerMode: snap.mode,
    },
  });
  await tx.gameTeam.updateMany({
    where: { gameId, id: { notIn: Object.keys(snap.teams) } },
    data: { buzzerState: BuzzerState.available },
  });
  for (const state of Object.values(BuzzerState)) {
    const ids = Object.entries(snap.teams)
      .filter(([, s]) => s === state)
      .map(([id]) => id);
    if (ids.length > 0) {
      await tx.gameTeam.updateMany({
        where: { gameId, id: { in: ids } },
        data: { buzzerState: state },
      });
    }
  }
  for (const status of Object.values(BuzzQueueStatus)) {
    const ids = Object.entries(snap.queue)
      .filter(([, s]) => s === status)
      .map(([id]) => id);
    if (ids.length > 0) {
      await tx.buzzQueueEntry.updateMany({
        where: { gameId, id: { in: ids } },
        data: { status },
      });
    }
  }
  if (snap.mode === BuzzerMode.queue) {
    await normalizeQueue(tx, gameId, snap.window);
  }
}

/**
 * Buzzes kept across an undo were judged against state the undo removed,
 * so restore the queue's rules: at most one team answering (the earliest),
 * the next in line answering if nobody is and nobody got it, and only the
 * answering team selected.
 */
async function normalizeQueue(tx: GameTx, gameId: string, window: number) {
  const teamIds = new Set(
    (
      await tx.gameTeam.findMany({ where: { gameId }, select: { id: true } })
    ).map((t) => t.id),
  );
  // Teams deleted since can't answer: their place in line is skipped. In
  // individual games, so is a removed player's (they are their own team).
  const { format } = await tx.game.findUniqueOrThrow({
    where: { id: gameId },
    select: { format: true },
  });
  const removedPlayers =
    format === GameFormat.individual
      ? (
          await tx.gameUser.findMany({
            where: { gameId, removedAt: { not: null } },
            select: { id: true },
          })
        ).map((u) => u.id)
      : [];
  await tx.buzzQueueEntry.updateMany({
    where: {
      gameId,
      window,
      status: { in: [BuzzQueueStatus.waiting, BuzzQueueStatus.answering] },
      OR: [
        { gameTeamId: { notIn: [...teamIds] } },
        { gameUserId: { in: removedPlayers } },
      ],
    },
    data: { status: BuzzQueueStatus.skipped },
  });
  const entries = await tx.buzzQueueEntry.findMany({
    where: { gameId, window },
    orderBy: { position: "asc" },
    select: { id: true, status: true, gameTeamId: true },
  });
  const answering = entries.filter(
    (e) => e.status === BuzzQueueStatus.answering,
  );
  let current = answering[0];
  const extra = answering.slice(1).map((e) => e.id);
  if (extra.length > 0) {
    await tx.buzzQueueEntry.updateMany({
      where: { id: { in: extra } },
      data: { status: BuzzQueueStatus.waiting },
    });
  }
  const solved = entries.some((e) => e.status === BuzzQueueStatus.correct);
  if (!current && !solved) {
    current = entries.find((e) => e.status === BuzzQueueStatus.waiting);
    if (current) {
      await tx.buzzQueueEntry.update({
        where: { id: current.id },
        data: { status: BuzzQueueStatus.answering },
      });
    }
  }
  await tx.gameTeam.updateMany({
    where: {
      gameId,
      buzzerState: BuzzerState.selected,
      ...(current ? { id: { not: current.gameTeamId } } : {}),
    },
    data: { buzzerState: BuzzerState.available },
  });
  if (current) {
    await tx.gameTeam.updateMany({
      where: { gameId, id: current.gameTeamId },
      data: { buzzerState: BuzzerState.selected },
    });
  }
}

async function readHistory(tx: GameTx | PrismaClient, gameId: string) {
  const row = await tx.buzzerHistory.findUnique({ where: { gameId } });
  return {
    past: (row?.past ?? []) as unknown as BuzzerHistoryEntry[],
    future: (row?.future ?? []) as unknown as BuzzerHistoryEntry[],
  };
}

async function writeHistory(
  tx: GameTx,
  gameId: string,
  past: BuzzerHistoryEntry[],
  future: BuzzerHistoryEntry[],
) {
  const data = {
    past: past.slice(-BUZZER_HISTORY_LIMIT) as unknown as Prisma.InputJsonValue,
    future: future.slice(
      -BUZZER_HISTORY_LIMIT,
    ) as unknown as Prisma.InputJsonValue,
  };
  await tx.buzzerHistory.upsert({
    where: { gameId },
    create: { gameId, ...data },
    update: data,
  });
}

/** An accepted buzz changes state, so redo would overwrite it: drop redo. */
async function clearRedo(tx: GameTx, gameId: string) {
  await tx.$executeRaw`
    UPDATE "BuzzerHistory" SET future = '[]'::jsonb, "updatedAt" = now()
    WHERE "gameId" = ${gameId} AND future <> '[]'::jsonb`;
}

type GameRow = {
  status: GameStatus;
  isBuzzerListening: boolean;
  buzzerWindow: number;
  buzzerMode: BuzzerMode;
};

/**
 * Runs one host buzzer action under the game lock and records it in
 * history (with the state before it) when it changed something.
 */
async function hostAction(
  gameId: string,
  work: (
    tx: GameTx,
    game: GameRow,
  ) => Promise<Result<{ label: string } | null, BuzzerControlError>>,
): Promise<Result<Changed, BuzzerControlError>> {
  const outcome = await withGameLock(gameId, async (tx) => {
    const game = await tx.game.findUniqueOrThrow({
      where: { id: gameId },
      select: {
        status: true,
        isBuzzerListening: true,
        buzzerWindow: true,
        buzzerMode: true,
      },
    });
    const before = await takeSnapshot(tx, gameId);
    const done = await work(tx, game);
    if (done.isErr()) return err<Changed, BuzzerControlError>(done.error);
    if (!done.value) return ok<Changed, BuzzerControlError>({ changed: false });
    const { past } = await readHistory(tx, gameId);
    await writeHistory(
      tx,
      gameId,
      [
        ...past,
        {
          label: done.value.label,
          at: new Date().toISOString(),
          snapshot: before,
        },
      ],
      [],
    );
    return ok<Changed, BuzzerControlError>({ changed: true });
  });
  return outcome.isErr() ? err(outcome.error) : outcome.value;
}

/** Starts a new question with a window number never used before. */
async function newWindow(tx: GameTx, gameId: string) {
  await tx.$executeRaw`
    UPDATE "Game"
    SET "buzzerWindowHigh" = GREATEST("buzzerWindowHigh", "buzzerWindow") + 1,
        "buzzerWindow" = GREATEST("buzzerWindowHigh", "buzzerWindow") + 1
    WHERE id = ${gameId}`;
}

// ------------------------------------------------------------- host actions

/**
 * Opens the buzzer. First-buzz mode: the previous winner becomes rejected
 * and a new window starts. Queue mode: the same question continues, so
 * late buzzes join the back of the queue. Opening in the lobby starts the
 * game.
 */
export function openBuzzer(gameId: string) {
  return hostAction(gameId, async (tx, game) => {
    if (game.status === GameStatus.finished) {
      return err({ kind: "gameFinished" as const });
    }
    if (game.isBuzzerListening) return ok(null);
    let label = "Open buzzer";
    const solved =
      game.buzzerMode === BuzzerMode.queue &&
      (await tx.buzzQueueEntry.count({
        where: {
          gameId,
          window: game.buzzerWindow,
          status: BuzzQueueStatus.correct,
        },
      })) > 0;
    if (solved) {
      // Someone already got this question: opening starts the next one.
      await tx.gameTeam.updateMany({
        where: { gameId },
        data: { buzzerState: BuzzerState.available },
      });
      await newWindow(tx, gameId);
      label = "Open buzzer for a new question";
    } else if (game.buzzerMode === BuzzerMode.first) {
      const { count } = await tx.gameTeam.updateMany({
        where: { gameId, buzzerState: BuzzerState.selected },
        data: { buzzerState: BuzzerState.rejected },
      });
      if (count > 0) label = "Reopen for others (wrong answer)";
      await newWindow(tx, gameId);
    }
    await tx.game.update({
      where: { id: gameId },
      data: { isBuzzerListening: true, status: GameStatus.running },
    });
    return ok({ label });
  });
}

/** Stops new buzzes. In queue mode the queue stays to work through. */
export function pauseBuzzer(gameId: string) {
  return hostAction(gameId, async (tx, game) => {
    if (!game.isBuzzerListening) return ok(null);
    await tx.game.update({
      where: { id: gameId },
      data: { isBuzzerListening: false },
    });
    return ok({ label: "Close buzzer" });
  });
}

/** Next question: clears every team's state and the queue, buzzer closed. */
export function resetBuzzer(gameId: string) {
  return hostAction(gameId, async (tx) => {
    await tx.gameTeam.updateMany({
      where: { gameId },
      data: { buzzerState: BuzzerState.available },
    });
    await newWindow(tx, gameId);
    await tx.game.update({
      where: { id: gameId },
      data: { isBuzzerListening: false },
    });
    return ok({ label: "Next question" });
  });
}

/** Switches between first-buzz and queue mode. Only while closed. */
export function setBuzzerMode(gameId: string, mode: BuzzerMode) {
  return hostAction(gameId, async (tx, game) => {
    if (game.buzzerMode === mode) return ok(null);
    if (game.isBuzzerListening) {
      return err({ kind: "buzzerOpenModeChange" as const });
    }
    await tx.gameTeam.updateMany({
      where: { gameId },
      data: { buzzerState: BuzzerState.available },
    });
    await newWindow(tx, gameId);
    await tx.game.update({ where: { id: gameId }, data: { buzzerMode: mode } });
    return ok({
      label:
        mode === BuzzerMode.queue
          ? "Switch to queued buzzing"
          : "Switch to first-buzz wins",
    });
  });
}

async function teamName(tx: GameTx, gameTeamId: string) {
  const team = await tx.gameTeam.findUnique({
    where: { id: gameTeamId },
    select: { name: true },
  });
  return team?.name ?? "a removed team";
}

/**
 * Takes teams out of the current question's queue, for example when a team
 * is deleted or an individual player is removed. Their waiting or answering
 * entries are skipped, and the next in line answers. Runs inside the
 * caller's game-locked transaction; not an undoable host action.
 */
export async function releaseTeamsFromQueue(
  tx: GameTx,
  gameId: string,
  gameTeamIds: string[],
) {
  if (gameTeamIds.length === 0) return;
  const game = await tx.game.findUniqueOrThrow({
    where: { id: gameId },
    select: { buzzerWindow: true, buzzerMode: true },
  });
  if (game.buzzerMode !== BuzzerMode.queue) return;
  const { count } = await tx.buzzQueueEntry.updateMany({
    where: {
      gameId,
      window: game.buzzerWindow,
      gameTeamId: { in: gameTeamIds },
      status: { in: [BuzzQueueStatus.waiting, BuzzQueueStatus.answering] },
    },
    data: { status: BuzzQueueStatus.skipped },
  });
  if (count > 0) await normalizeQueue(tx, gameId, game.buzzerWindow);
}

/** The next waiting entry becomes answering. */
async function advanceQueue(tx: GameTx, gameId: string, window: number) {
  const next = await tx.buzzQueueEntry.findFirst({
    where: { gameId, window, status: BuzzQueueStatus.waiting },
    orderBy: { position: "asc" },
  });
  if (!next) return;
  await tx.buzzQueueEntry.update({
    where: { id: next.id },
    data: { status: BuzzQueueStatus.answering },
  });
  await tx.gameTeam.updateMany({
    where: { id: next.gameTeamId, gameId },
    data: { buzzerState: BuzzerState.selected },
  });
}

export type QueueVerdict = "correct" | "wrong" | "skip";

/**
 * The host's verdict on a queue entry:
 * - correct: the answering team was right; the buzzer closes.
 * - wrong: locked out for this question; the next team answers.
 * - skip: moves on with no lockout (also removes a waiting entry).
 */
export function judgeQueueEntry(
  gameId: string,
  entryId: string,
  verdict: QueueVerdict,
) {
  return hostAction(gameId, async (tx, game) => {
    const entry = await tx.buzzQueueEntry.findFirst({
      where: { id: entryId, gameId, window: game.buzzerWindow },
    });
    if (!entry) return err({ kind: "queueEntryNotFound" as const });
    const answering = entry.status === BuzzQueueStatus.answering;
    const waiting = entry.status === BuzzQueueStatus.waiting;
    if (verdict === "skip" ? !answering && !waiting : !answering) {
      return err({ kind: "queueEntryNotActive" as const });
    }
    const name = await teamName(tx, entry.gameTeamId);
    if (verdict === "correct") {
      await tx.buzzQueueEntry.update({
        where: { id: entry.id },
        data: { status: BuzzQueueStatus.correct },
      });
      await tx.game.update({
        where: { id: gameId },
        data: { isBuzzerListening: false },
      });
      return ok({ label: `Correct: ${name}` });
    }
    if (verdict === "wrong") {
      await tx.buzzQueueEntry.update({
        where: { id: entry.id },
        data: { status: BuzzQueueStatus.wrong },
      });
      await tx.gameTeam.updateMany({
        where: { id: entry.gameTeamId, gameId },
        data: { buzzerState: BuzzerState.rejected },
      });
      await advanceQueue(tx, gameId, game.buzzerWindow);
      return ok({ label: `Wrong: ${name}` });
    }
    await tx.buzzQueueEntry.update({
      where: { id: entry.id },
      data: { status: BuzzQueueStatus.skipped },
    });
    if (answering) {
      await tx.gameTeam.updateMany({
        where: { id: entry.gameTeamId, gameId },
        data: { buzzerState: BuzzerState.available },
      });
      await advanceQueue(tx, gameId, game.buzzerWindow);
    }
    return ok({
      label: `${answering ? "Skip" : "Remove from queue"}: ${name}`,
    });
  });
}

/** Undoes the last host buzzer action. */
export async function undoBuzzer(
  gameId: string,
): Promise<Result<Changed, BuzzerControlError>> {
  return moveInHistory(gameId, "undo");
}

/** Re-applies the last undone host buzzer action. */
export async function redoBuzzer(
  gameId: string,
): Promise<Result<Changed, BuzzerControlError>> {
  return moveInHistory(gameId, "redo");
}

async function moveInHistory(
  gameId: string,
  direction: "undo" | "redo",
): Promise<Result<Changed, BuzzerControlError>> {
  const outcome = await withGameLock(gameId, async (tx) => {
    const { past, future } = await readHistory(tx, gameId);
    const from = direction === "undo" ? past : future;
    const entry = from.at(-1);
    if (!entry) {
      return err<Changed, BuzzerControlError>({
        kind:
          direction === "undo" ? "nothingToUndoBuzzer" : "nothingToRedoBuzzer",
      });
    }
    const current = await takeSnapshot(tx, gameId);
    await applySnapshot(tx, gameId, entry.snapshot);
    const moved = { ...entry, snapshot: current };
    if (direction === "undo") {
      await writeHistory(tx, gameId, past.slice(0, -1), [...future, moved]);
    } else {
      await writeHistory(tx, gameId, [...past, moved], future.slice(0, -1));
    }
    return ok<Changed, BuzzerControlError>({ changed: true });
  });
  return outcome.isErr() ? err(outcome.error) : outcome.value;
}

export type BuzzerHistoryView = {
  /** Most recent first. */
  past: { label: string; at: string }[];
  /** Next redo first. */
  future: { label: string; at: string }[];
};

/** Labels for the host desk's undo/redo buttons and recent-actions list. */
export async function buzzerHistory(
  gameId: string,
): Promise<BuzzerHistoryView> {
  const { past, future } = await readHistory(defaultDb, gameId);
  const strip = (e: BuzzerHistoryEntry) => ({ label: e.label, at: e.at });
  return {
    past: past.slice(-10).reverse().map(strip),
    future: future.slice(-10).reverse().map(strip),
  };
}

// ------------------------------------------------------------- buzzing

/**
 * A participant buzzes. First-buzz mode accepts at most one buzz per
 * window; queue mode queues one entry per team per question.
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
  const { settled, mode } = await settledOutcome({
    gameId,
    gameUserId,
    requestId,
  });
  if (settled) return settled;
  if (mode === BuzzerMode.queue) {
    return queueBuzzIn({ gameId, gameUserId, requestId });
  }

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
          AND "buzzerMode" = 'first'::"BuzzerMode"
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
      await clearRedo(tx, gameId);
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
    (await settledOutcome({ gameId, gameUserId, requestId })).settled ??
    err({ kind: "notListening" })
  );
}

/**
 * Queue mode: positions must be handed out in order, so every buzz takes
 * the game lock (milliseconds each). One active entry per team per
 * question; a team skipped by the host may buzz again.
 */
async function queueBuzzIn({
  gameId,
  gameUserId,
  requestId,
}: {
  gameId: string;
  gameUserId: string;
  requestId?: string;
}): Promise<Result<BuzzOutcome, BuzzError>> {
  const outcome = await withGameLock(
    gameId,
    async (tx): Promise<Result<BuzzOutcome, BuzzError>> => {
      if (requestId) {
        const previous = await tx.buzzQueueEntry.findUnique({
          where: { gameId_requestId: { gameId, requestId } },
        });
        if (previous) {
          return previous.gameUserId === gameUserId
            ? ok({ accepted: true, replayed: true })
            : err({ kind: "requestIdReused" });
        }
      }
      const [game, gameUser] = await Promise.all([
        tx.game.findUniqueOrThrow({
          where: { id: gameId },
          select: {
            status: true,
            isBuzzerListening: true,
            buzzerWindow: true,
            buzzerMode: true,
          },
        }),
        tx.gameUser.findFirst({
          where: { id: gameUserId, gameId },
          select: {
            gameTeamId: true,
            gameTeam: { select: { buzzerState: true } },
          },
        }),
      ]);
      if (!gameUser) return err({ kind: "participantNotFound" });
      if (!gameUser.gameTeamId || !gameUser.gameTeam) {
        return err({ kind: "notOnTeam" });
      }
      if (gameUser.gameTeam.buzzerState === BuzzerState.rejected) {
        return err({ kind: "teamRejected" });
      }
      const window = game.buzzerWindow;
      const active = await tx.buzzQueueEntry.findFirst({
        where: {
          gameId,
          window,
          gameTeamId: gameUser.gameTeamId,
          status: { in: [BuzzQueueStatus.waiting, BuzzQueueStatus.answering] },
        },
      });
      if (active) return ok({ accepted: true, replayed: true });
      if (game.status === GameStatus.finished) {
        return err({ kind: "gameFinished" });
      }
      if (!game.isBuzzerListening || game.buzzerMode !== BuzzerMode.queue) {
        return err({ kind: "notListening" });
      }
      const [last, answering] = await Promise.all([
        tx.buzzQueueEntry.findFirst({
          where: { gameId, window },
          orderBy: { position: "desc" },
          select: { position: true },
        }),
        tx.buzzQueueEntry.count({
          where: { gameId, window, status: BuzzQueueStatus.answering },
        }),
      ]);
      await tx.buzzQueueEntry.create({
        data: {
          gameId,
          window,
          position: (last?.position ?? 0) + 1,
          gameTeamId: gameUser.gameTeamId,
          gameUserId,
          status: BuzzQueueStatus.waiting,
          requestId,
        },
      });
      // Nobody answering: the earliest in line answers, which is this buzz
      // unless an earlier team is still waiting.
      if (answering === 0) await advanceQueue(tx, gameId, window);
      await clearRedo(tx, gameId);
      return ok({ accepted: true, replayed: false });
    },
  );
  return outcome.isErr() ? err(outcome.error) : outcome.value;
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
 * Answers a first-buzz-mode buzz without the game lock when committed state
 * already decides it: a retried claim, a team that already holds or lost
 * the buzz, a finished game, or a closed buzzer. These are the same answers
 * the locked path gives for a request that arrived at that moment. Queue
 * mode always goes to its locked path (`settled` null, `mode` queue).
 */
async function settledOutcome({
  gameId,
  gameUserId,
  requestId,
}: {
  gameId: string;
  gameUserId: string;
  requestId?: string;
}): Promise<{
  settled: Result<BuzzOutcome, BuzzError> | null;
  mode: BuzzerMode | null;
}> {
  if (requestId) {
    const previous = await defaultDb.buzzClaim.findUnique({
      where: { gameId_requestId: { gameId, requestId } },
    });
    if (previous) {
      return {
        settled:
          previous.gameUserId === gameUserId
            ? ok({ accepted: true, replayed: true })
            : err({ kind: "requestIdReused" }),
        mode: null,
      };
    }
  }
  const gameUser = await defaultDb.gameUser.findFirst({
    where: { id: gameUserId, gameId },
    select: {
      gameTeam: { select: { buzzerState: true } },
      game: {
        select: { status: true, isBuzzerListening: true, buzzerMode: true },
      },
    },
  });
  if (!gameUser) return { settled: null, mode: null };
  const mode = gameUser.game.buzzerMode;
  if (mode === BuzzerMode.queue || !gameUser.gameTeam) {
    return { settled: null, mode };
  }
  if (gameUser.gameTeam.buzzerState === BuzzerState.rejected) {
    return { settled: err({ kind: "teamRejected" }), mode };
  }
  if (gameUser.gameTeam.buzzerState === BuzzerState.selected) {
    return { settled: ok({ accepted: true, replayed: true }), mode };
  }
  if (gameUser.game.status === GameStatus.finished) {
    return { settled: err({ kind: "gameFinished" }), mode };
  }
  if (!gameUser.game.isBuzzerListening) {
    return { settled: err({ kind: "notListening" }), mode };
  }
  return { settled: null, mode };
}

/**
 * Who holds the buzz in the current question: the first-mode claim, or in
 * queue mode the answering (or correct) entry. A `selected` team without a
 * claim can only come from before PR04; it is reported with an unknown
 * participant rather than hidden.
 */
export async function getBuzzWinner(
  gameId: string,
  client: PrismaClient | GameTx = defaultDb,
): Promise<BuzzWinner | null> {
  const game = await client.game.findUnique({
    where: { id: gameId },
    select: { buzzerWindow: true, buzzerMode: true },
  });
  if (!game) return null;

  if (game.buzzerMode === BuzzerMode.queue) {
    const holder = await client.buzzQueueEntry.findFirst({
      where: {
        gameId,
        window: game.buzzerWindow,
        status: { in: [BuzzQueueStatus.answering, BuzzQueueStatus.correct] },
      },
      orderBy: { position: "asc" },
    });
    return holder
      ? { gameUserId: holder.gameUserId, gameTeamId: holder.gameTeamId }
      : null;
  }

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

export type QueueEntryView = {
  id: string;
  position: number;
  gameTeamId: string;
  gameUserId: string;
  status: BuzzQueueStatus;
};

/** The current question's queue (queue mode), in order. */
export async function getBuzzQueue(
  gameId: string,
  client: PrismaClient | GameTx = defaultDb,
): Promise<QueueEntryView[]> {
  const game = await client.game.findUnique({
    where: { id: gameId },
    select: { buzzerWindow: true, buzzerMode: true },
  });
  if (game?.buzzerMode !== BuzzerMode.queue) return [];
  return client.buzzQueueEntry.findMany({
    where: { gameId, window: game.buzzerWindow },
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      gameTeamId: true,
      gameUserId: true,
      status: true,
    },
  });
}
