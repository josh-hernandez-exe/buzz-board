/**
 * Category Grid: drafts, start, play and undo. Like Ranked Answers, each
 * action runs under the game lock, writes its points through the shared
 * score writer in the same transaction, is applied once per request ID,
 * and is refused if another host changed the grid first.
 */
import { createHash } from "node:crypto";

import { GameStatus, type Prisma } from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import { db } from "@/server/db";
import {
  withGameLock,
  type GameTransactionError,
  type GameTx,
} from "@/server/db/gameTransaction";
import type { ModeError } from "@/server/modes/rankedAnswersService";
import { scoreCommandInTx } from "@/server/scores/scoreService";
import {
  bankSchema,
  emptyBank,
  gridPreflight,
  type Bank,
  type GridPreflight,
} from "@/utils/categoryGrid/content";
import {
  applyGrid,
  initialGridState,
  undoGrid,
  type GridAction,
  type GridError,
  type GridState,
} from "@/utils/categoryGrid/engine";
import {
  projectGrid,
  type PublicGridView,
} from "@/utils/categoryGrid/projection";

export const GRID_KIND = "categoryGrid";
const HISTORY_LIMIT = 50;

export type GridModeError =
  | Exclude<ModeError, { kind: "modeRule" }>
  | { kind: "gridRule"; error: GridError };

type HistoryEntry = { state: GridState; scores: Record<string, number> };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function flatten<T>(
  result: Result<Result<T, GridModeError>, GameTransactionError>,
): Result<T, GridModeError> {
  return result.isErr() ? err(result.error) : result.value;
}

async function teamsInOrder(client: GameTx | typeof db, gameId: string) {
  return client.gameTeam.findMany({
    where: { gameId },
    orderBy: { index: "asc" },
    select: {
      id: true,
      name: true,
      _count: { select: { gameUsers: { where: { removedAt: null } } } },
    },
  });
}

export type GridHostView = {
  status: "none" | "draft" | "running" | "ended";
  otherMode: string | null;
  draft: Bank;
  draftRevision: number;
  preflight: GridPreflight;
  /** Frozen content while running or ended, with every answer. */
  content: Bank | null;
  state: GridState | null;
  step: number;
  canUndo: boolean;
  teams: { id: string; name: string; players: number }[];
  view: PublicGridView | null;
};

/** Everything the host desk needs, including answers. Owners and co-hosts only. */
export async function gridHostView(gameId: string): Promise<GridHostView> {
  const [stored, teams] = await Promise.all([
    db.gameMode.findUnique({ where: { gameId } }),
    teamsInOrder(db, gameId),
  ]);
  const otherMode = stored && stored.kind !== GRID_KIND ? stored.kind : null;
  const mode = otherMode ? null : stored;
  const draft = mode ? bankSchema.parse(mode.draft) : emptyBank();
  const content = mode?.content ? bankSchema.parse(mode.content) : null;
  const state = (mode?.state as unknown as GridState | null) ?? null;
  return {
    status: (mode?.status as GridHostView["status"] | undefined) ?? "none",
    otherMode,
    draft,
    draftRevision: mode?.draftRevision ?? 0,
    preflight: gridPreflight(draft, teams.length),
    content,
    state,
    step: mode?.step ?? 0,
    canUndo:
      mode?.status === "running" &&
      (mode.history as unknown as HistoryEntry[]).length > 0,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      players: t._count.gameUsers,
    })),
    view:
      content && state && mode
        ? projectGrid(
            content,
            state,
            mode.status === "ended" ? "ended" : "running",
          )
        : null,
  };
}

export async function saveGridDraft({
  gameId,
  draft,
  expectedRevision,
}: {
  gameId: string;
  draft: unknown;
  expectedRevision: number;
}): Promise<Result<{ draftRevision: number }, GridModeError>> {
  const parsed = bankSchema.safeParse(draft);
  if (!parsed.success) {
    return err({
      kind: "invalidContent",
      issues: parsed.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const mode = await tx.gameMode.findUnique({ where: { gameId } });
      if (mode && mode.kind !== GRID_KIND) {
        return err({ kind: "otherMode", mode: mode.kind });
      }
      if (mode && mode.status !== "draft") {
        return err({ kind: "modeAlreadyStarted" });
      }
      const current = mode?.draftRevision ?? 0;
      if (current !== expectedRevision) {
        return err({ kind: "draftConflict", draftRevision: current });
      }
      const saved = await tx.gameMode.upsert({
        where: { gameId },
        create: {
          gameId,
          kind: GRID_KIND,
          draft: json(parsed.data),
          draftRevision: 1,
        },
        update: { draft: json(parsed.data), draftRevision: { increment: 1 } },
      });
      return ok({ draftRevision: saved.draftRevision });
    }),
  );
}

export async function startGrid(
  gameId: string,
): Promise<Result<{ step: number }, GridModeError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const [mode, game, teams] = await Promise.all([
        tx.gameMode.findUnique({ where: { gameId } }),
        tx.game.findUniqueOrThrow({
          where: { id: gameId },
          select: { status: true },
        }),
        teamsInOrder(tx, gameId),
      ]);
      if (game.status === GameStatus.finished) {
        return err({ kind: "gameFinished" });
      }
      if (!mode) {
        return err({
          kind: "preflightBlocked",
          problems: ["Fill in the grid and save it first."],
        });
      }
      if (mode.kind !== GRID_KIND) {
        return err({ kind: "otherMode", mode: mode.kind });
      }
      if (mode.status !== "draft") return err({ kind: "modeAlreadyStarted" });
      const bank = bankSchema.parse(mode.draft);
      const check = gridPreflight(bank, teams.length);
      if (check.blocking.length > 0) {
        return err({ kind: "preflightBlocked", problems: check.blocking });
      }
      await tx.gameMode.update({
        where: { gameId },
        data: {
          status: "running",
          content: json(bank),
          state: json(initialGridState(teams.map((t) => t.id))),
          history: [],
          step: 1,
          startedAt: new Date(),
        },
      });
      if (game.status === GameStatus.lobby) {
        await tx.game.update({
          where: { id: gameId },
          data: { status: GameStatus.running },
        });
      }
      return ok({ step: 1 });
    }),
  );
}

/** Adds points, skipping teams deleted since; returns what was applied. */
async function applyScores(
  tx: GameTx,
  gameId: string,
  actorUserId: string,
  requestId: string,
  scores: Record<string, number>,
): Promise<Result<Record<string, number>, GridModeError>> {
  const existing = new Set(
    (
      await tx.gameTeam.findMany({ where: { gameId }, select: { id: true } })
    ).map((t) => t.id),
  );
  const changes = Object.fromEntries(
    Object.entries(scores).filter(([t, p]) => p !== 0 && existing.has(t)),
  );
  if (Object.keys(changes).length === 0) return ok({});
  const result = await scoreCommandInTx(tx, {
    gameId,
    actorUserId,
    requestId: `${requestId}-score`,
    command: { kind: "add", changes },
  });
  return result.isErr() ? err(result.error) : ok(changes);
}

export async function actInGrid({
  gameId,
  actorUserId,
  action,
  expectedStep,
  requestId,
}: {
  gameId: string;
  actorUserId: string;
  action: GridAction;
  expectedStep: number;
  requestId: string;
}): Promise<Result<{ step: number; replayed: boolean }, GridModeError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const [replay, mode] = await Promise.all([
        tx.gameOperation.findUnique({
          where: { gameId_requestId: { gameId, requestId } },
        }),
        tx.gameMode.findUnique({ where: { gameId } }),
      ]);
      if (replay) return ok({ step: mode?.step ?? 0, replayed: true });
      if (mode?.status !== "running" || mode.kind !== GRID_KIND) {
        return err({ kind: "modeNotRunning" });
      }
      if (mode.step !== expectedStep) {
        return err({ kind: "stepConflict", step: mode.step });
      }
      const stored = mode.state as unknown as GridState;
      // Judging and picking use the teams in the game now.
      const teams = (await teamsInOrder(tx, gameId)).map((t) => t.id);
      const step = applyGrid(bankSchema.parse(mode.content), { ...stored, teams }, action);
      if (step.isErr()) return err({ kind: "gridRule", error: step.error });
      const scored = await applyScores(
        tx,
        gameId,
        actorUserId,
        requestId,
        step.value.scores,
      );
      if (scored.isErr()) return err(scored.error);
      const history = [
        ...(mode.history as unknown as HistoryEntry[]),
        { state: stored, scores: scored.value },
      ].slice(-HISTORY_LIMIT);
      await tx.gameMode.update({
        where: { gameId },
        data: {
          state: json(step.value.state),
          history: json(history),
          step: { increment: 1 },
        },
      });
      await tx.gameOperation.create({
        data: {
          gameId,
          requestId,
          action: `grid.${action.type}`,
          actorUserId,
          payloadHash: hash(action),
          result: json({ step: mode.step + 1, scores: scored.value }),
        },
      });
      return ok({ step: mode.step + 1, replayed: false });
    }),
  );
}

/**
 * Undoes the last action and its points. A clue that was shown stays used
 * up, and an answer that was shown stays shown.
 */
export async function undoInGrid({
  gameId,
  actorUserId,
  expectedStep,
  requestId,
}: {
  gameId: string;
  actorUserId: string;
  expectedStep: number;
  requestId: string;
}): Promise<Result<{ step: number }, GridModeError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const mode = await tx.gameMode.findUnique({ where: { gameId } });
      if (mode?.status !== "running" || mode.kind !== GRID_KIND) {
        return err({ kind: "modeNotRunning" });
      }
      if (mode.step !== expectedStep) {
        return err({ kind: "stepConflict", step: mode.step });
      }
      const history = mode.history as unknown as HistoryEntry[];
      const last = history.at(-1);
      if (!last) return err({ kind: "nothingToUndoInMode" });
      const reverse = Object.fromEntries(
        Object.entries(last.scores).map(([t, p]) => [t, -p]),
      );
      const scored = await applyScores(
        tx,
        gameId,
        actorUserId,
        requestId,
        reverse,
      );
      if (scored.isErr()) return err(scored.error);
      await tx.gameMode.update({
        where: { gameId },
        data: {
          state: json(undoGrid(mode.state as unknown as GridState, last.state)),
          history: json(history.slice(0, -1)),
          step: { increment: 1 },
        },
      });
      return ok({ step: mode.step + 1 });
    }),
  );
}

/** "Use basic controls": stops the grid for good; scores stay. */
export async function endGrid(
  gameId: string,
): Promise<Result<{ changed: boolean }, GridModeError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const { count } = await tx.gameMode.updateMany({
        where: { gameId, kind: GRID_KIND, status: "running" },
        data: { status: "ended", endedAt: new Date() },
      });
      return ok<{ changed: boolean }, GridModeError>({ changed: count > 0 });
    }),
  );
}

export async function discardGridDraft(
  gameId: string,
): Promise<Result<{ changed: boolean }, GridModeError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const { count } = await tx.gameMode.deleteMany({
        where: { gameId, kind: GRID_KIND, status: "draft" },
      });
      return ok<{ changed: boolean }, GridModeError>({ changed: count > 0 });
    }),
  );
}
