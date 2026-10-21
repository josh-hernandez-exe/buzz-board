/**
 * Ranked Answers games: draft editing, start (freeze), host actions and
 * undo. Every action runs under the game lock, and the points it awards go
 * through the shared score writer in the same transaction, so the board and
 * the scoreboard can never disagree.
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
import {
  scoreCommandInTx,
  type ScoreCommandError,
} from "@/server/scores/scoreService";
import {
  contentSchema,
  defaultRules,
  preflight,
  type Content,
  type Preflight,
} from "@/utils/rankedAnswers/content";
import {
  apply,
  initialState,
  undoTo,
  type Action,
  type EngineError,
  type EngineState,
} from "@/utils/rankedAnswers/engine";
import {
  publicModeView,
  type PublicModeView,
} from "@/utils/rankedAnswers/projection";

export const MODE_KIND = "rankedAnswers";
/** Undo goes back at most this many steps. */
const HISTORY_LIMIT = 50;

export type ModeError =
  | GameTransactionError
  | ScoreCommandError
  | { kind: "invalidContent"; issues: string[] }
  | { kind: "draftConflict"; draftRevision: number }
  | { kind: "modeAlreadyStarted" }
  | { kind: "modeNotRunning" }
  | { kind: "preflightBlocked"; problems: string[] }
  | { kind: "stepConflict"; step: number }
  | { kind: "modeRule"; error: EngineError }
  | { kind: "nothingToUndoInMode" };

type HistoryEntry = { state: EngineState; scores: Record<string, number> };
type Json = Prisma.InputJsonValue;
const json = (value: unknown) => value as Json;

function flatten<T>(
  result: Result<Result<T, ModeError>, GameTransactionError>,
): Result<T, ModeError> {
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

export type HostView = {
  status: "none" | "draft" | "running" | "ended";
  draft: Content;
  draftRevision: number;
  preflight: Preflight;
  /** Frozen content while running or ended. */
  content: Content | null;
  state: EngineState | null;
  step: number;
  canUndo: boolean;
  teams: { id: string; name: string; players: number }[];
  view: PublicModeView | null;
};

/** Everything the host desk needs, including every answer. Staff only. */
export async function hostView(gameId: string): Promise<HostView> {
  const [mode, teams] = await Promise.all([
    db.gameMode.findUnique({ where: { gameId } }),
    teamsInOrder(db, gameId),
  ]);
  const draft: Content = mode
    ? (mode.draft as unknown as Content)
    : { rules: defaultRules(teams.length), boards: [] };
  const check = preflight(draft, teams.length);
  const emptyTeams = teams
    .filter((t) => t._count.gameUsers === 0)
    .map((t) => `${t.name} has no players yet.`);
  return {
    status: (mode?.status as HostView["status"] | undefined) ?? "none",
    draft,
    draftRevision: mode?.draftRevision ?? 0,
    preflight: { ...check, warnings: [...check.warnings, ...emptyTeams] },
    content: (mode?.content as unknown as Content | null) ?? null,
    state: (mode?.state as unknown as EngineState | null) ?? null,
    step: mode?.step ?? 0,
    canUndo:
      mode?.status === "running" &&
      (mode.history as unknown as HistoryEntry[]).length > 0,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      players: t._count.gameUsers,
    })),
    view: publicModeView(mode),
  };
}

/**
 * Saves the draft. `expectedRevision` is the revision the editor loaded: if
 * someone else saved since, nothing is overwritten.
 */
export async function saveDraft({
  gameId,
  draft,
  expectedRevision,
}: {
  gameId: string;
  draft: unknown;
  expectedRevision: number;
}): Promise<Result<{ draftRevision: number }, ModeError>> {
  const parsed = contentSchema.safeParse(draft);
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
          kind: MODE_KIND,
          draft: json(parsed.data),
          draftRevision: 1,
        },
        update: { draft: json(parsed.data), draftRevision: { increment: 1 } },
      });
      return ok({ draftRevision: saved.draftRevision });
    }),
  );
}

/** Freezes the draft and starts play. Blocking preflight problems refuse. */
export async function startMode(
  gameId: string,
): Promise<Result<{ step: number }, ModeError>> {
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
          problems: ["Add boards and save them first."],
        });
      }
      if (mode.status !== "draft") return err({ kind: "modeAlreadyStarted" });
      const content = contentSchema.parse(mode.draft);
      const check = preflight(content, teams.length);
      if (check.blocking.length > 0) {
        return err({ kind: "preflightBlocked", problems: check.blocking });
      }
      await tx.gameMode.update({
        where: { gameId },
        data: {
          status: "running",
          content: json(content),
          state: json(initialState(teams.map((t) => t.id))),
          history: [],
          step: 1,
          startedAt: new Date(),
        },
      });
      // Starting the mode starts the game, as opening the buzzer does.
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

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * Adds the points to the scoreboard and returns what was applied. Teams
 * deleted since the board started are skipped: their scores are gone, and
 * one missing team must never block play or undo for everyone else.
 */
async function applyScores(
  tx: GameTx,
  gameId: string,
  actorUserId: string,
  requestId: string,
  scores: Record<string, number>,
): Promise<Result<Record<string, number>, ModeError>> {
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

/**
 * Applies one host action. `expectedStep` is the step the host's screen
 * showed: if another host acted first, nothing happens and the screen
 * refreshes. A retried request (same `requestId`) is a no-op.
 */
export async function actInMode({
  gameId,
  actorUserId,
  action,
  expectedStep,
  requestId,
}: {
  gameId: string;
  actorUserId: string;
  action: Action;
  expectedStep: number;
  requestId: string;
}): Promise<Result<{ step: number; replayed: boolean }, ModeError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const [replay, mode] = await Promise.all([
        tx.gameOperation.findUnique({
          where: { gameId_requestId: { gameId, requestId } },
        }),
        tx.gameMode.findUnique({ where: { gameId } }),
      ]);
      if (replay) return ok({ step: mode?.step ?? 0, replayed: true });
      if (mode?.status !== "running") {
        return err({ kind: "modeNotRunning" });
      }
      if (mode.step !== expectedStep) {
        return err({ kind: "stepConflict", step: mode.step });
      }
      let state = mode.state as unknown as EngineState;
      if (action.type === "startBoard") {
        // Each board is played by the teams in the game now: a team added
        // since the start joins in, a deleted one drops out.
        const current = (await teamsInOrder(tx, gameId)).map((t) => t.id);
        state = { ...state, teams: current };
      }
      const step = apply(mode.content as unknown as Content, state, action);
      if (step.isErr()) {
        return err({ kind: "modeRule", error: step.error });
      }
      const scored = await applyScores(
        tx,
        gameId,
        actorUserId,
        requestId,
        step.value.scores,
      );
      if (scored.isErr()) return err(scored.error);

      // Undo reverses exactly what was applied.
      const history = [
        ...(mode.history as unknown as HistoryEntry[]),
        { state: mode.state as unknown as EngineState, scores: scored.value },
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
          action: `ranked.${action.type}`,
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
 * Undoes the last action and takes back the points it awarded, in one
 * transaction. Answers already shown stay shown, for 0 points.
 */
export async function undoInMode({
  gameId,
  actorUserId,
  expectedStep,
  requestId,
}: {
  gameId: string;
  actorUserId: string;
  expectedStep: number;
  requestId: string;
}): Promise<Result<{ step: number }, ModeError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const mode = await tx.gameMode.findUnique({ where: { gameId } });
      if (mode?.status !== "running") {
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
          state: json(undoTo(mode.state as unknown as EngineState, last.state)),
          history: json(history.slice(0, -1)),
          step: { increment: 1 },
        },
      });
      return ok({ step: mode.step + 1 });
    }),
  );
}

/**
 * "Use basic controls": stops the mode for good. The room, players, chat
 * and scores stay; the host carries on with buzzers and manual scores.
 */
export async function endMode(
  gameId: string,
): Promise<Result<{ changed: boolean }, ModeError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const { count } = await tx.gameMode.updateMany({
        where: { gameId, status: "running" },
        data: { status: "ended", endedAt: new Date() },
      });
      return ok<{ changed: boolean }, ModeError>({ changed: count > 0 });
    }),
  );
}

/** Throws away an unstarted draft. A started mode's record is kept. */
export async function discardDraft(
  gameId: string,
): Promise<Result<{ changed: boolean }, ModeError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const { count } = await tx.gameMode.deleteMany({
        where: { gameId, status: "draft" },
      });
      return ok<{ changed: boolean }, ModeError>({ changed: count > 0 });
    }),
  );
}
