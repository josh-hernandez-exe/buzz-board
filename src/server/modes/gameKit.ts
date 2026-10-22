/**
 * Game Kit: the shared runner behind every game mode (Ranked Answers,
 * Category Grid, Sequential Quiz). A mode is a small module (content
 * schema, preflight, pure engine, honest undo, public projection); this
 * file owns everything they share, so it's written and tested once:
 *
 * - one mode per game (`GameMode.kind`), drafts with conflict protection;
 * - start freezes the draft and moves a lobby game to live;
 * - each host action runs under the game lock, is applied once per
 *   request ID, is refused if another host changed it first (step), and
 *   writes its points through the shared score writer in the same
 *   transaction;
 * - points for teams deleted since are skipped, so they never block play;
 * - undo reverses exactly the points applied;
 * - a score-history barrier after every mode score change, so the
 *   scoreboard's own undo can't pull points out from under the board;
 * - "Use basic controls" (W23 handoff): one transaction ends the mode for
 *   good, closes the buzzer and sets the barrier.
 *
 * See docs/game-kit.md for the module recipe.
 */
import { createHash, randomUUID } from "node:crypto";

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
import type { GridError } from "@/utils/categoryGrid/engine";
import type { ModeKind } from "@/utils/modes";
import type { EngineError } from "@/utils/rankedAnswers/engine";

/** Rule refusals from a mode's engine, as API errors. */
export type ModeRuleError =
  | { kind: "modeRule"; error: EngineError }
  | { kind: "gridRule"; error: GridError };

export type GameKitError =
  | GameTransactionError
  | ScoreCommandError
  | { kind: "invalidContent"; issues: string[] }
  | { kind: "draftConflict"; draftRevision: number }
  | { kind: "modeAlreadyStarted" }
  | { kind: "modeNotRunning" }
  | { kind: "preflightBlocked"; problems: string[] }
  | { kind: "stepConflict"; step: number }
  | { kind: "nothingToUndoInMode" }
  /** The game is set up for a different game mode. */
  | { kind: "otherMode"; mode: string }
  | ModeRuleError;

export type Preflight = { blocking: string[]; warnings: string[] };
export type ModeTeam = { id: string; name: string; players: number };

/**
 * What a game mode provides. `Content` is its frozen setup (boards, a
 * question bank…), `State` its running state, `Action` a host step.
 */
export type ModeModule<
  Content,
  State,
  Action extends { type: string },
  RuleError,
> = {
  kind: ModeKind;
  /** Validates a saved draft. Drafts may be unfinished; preflight judges readiness. */
  parseDraft: (raw: unknown) => Result<Content, string[]>;
  emptyDraft: (teamCount: number) => Content;
  preflight: (content: Content, teams: ModeTeam[]) => Preflight;
  initialState: (teamIds: string[]) => State;
  /**
   * Called before each action with the teams in the game now, so a team
   * added or deleted since the start is taken into account.
   */
  withTeams: (state: State, action: Action, teamIds: string[]) => State;
  apply: (
    content: Content,
    state: State,
    action: Action,
  ) => Result<{ state: State; scores: Record<string, number> }, RuleError>;
  /** Undo that never hides what people have seen. */
  undo: (current: State, previous: State) => State;
  ruleError: (error: RuleError) => ModeRuleError;
};

type HistoryEntry<State> = { state: State; scores: Record<string, number> };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Undo goes back at most this many steps. */
const HISTORY_LIMIT = 50;

function flatten<T>(
  result: Result<Result<T, GameKitError>, GameTransactionError>,
): Result<T, GameKitError> {
  return result.isErr() ? err(result.error) : result.value;
}

export async function teamsInOrder(client: GameTx | typeof db, gameId: string) {
  const teams = await client.gameTeam.findMany({
    where: { gameId },
    orderBy: { index: "asc" },
    select: {
      id: true,
      name: true,
      _count: { select: { gameUsers: { where: { removedAt: null } } } },
    },
  });
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    players: t._count.gameUsers,
  }));
}

export type ModeHostData<Content, State> = {
  status: "none" | "draft" | "running" | "ended";
  otherMode: string | null;
  draft: Content;
  draftRevision: number;
  preflight: Preflight;
  /** Frozen content while running or ended. */
  content: Content | null;
  state: State | null;
  step: number;
  canUndo: boolean;
  teams: ModeTeam[];
};

/** Everything a host desk needs for a mode, including hidden content. Staff only. */
export async function modeHostData<C, S, A extends { type: string }, E>(
  module: ModeModule<C, S, A, E>,
  gameId: string,
): Promise<ModeHostData<C, S>> {
  const [stored, teams] = await Promise.all([
    db.gameMode.findUnique({ where: { gameId } }),
    teamsInOrder(db, gameId),
  ]);
  const otherMode = stored && stored.kind !== module.kind ? stored.kind : null;
  const mode = otherMode ? null : stored;
  const parsed = mode ? module.parseDraft(mode.draft) : null;
  const draft = parsed?.isOk() ? parsed.value : module.emptyDraft(teams.length);
  const content = mode?.content
    ? module.parseDraft(mode.content).unwrapOr(null)
    : null;
  return {
    status:
      (mode?.status as ModeHostData<C, S>["status"] | undefined) ?? "none",
    otherMode,
    draft,
    draftRevision: mode?.draftRevision ?? 0,
    preflight: module.preflight(draft, teams),
    content,
    state: (mode?.state as S | null | undefined) ?? null,
    step: mode?.step ?? 0,
    canUndo:
      mode?.status === "running" &&
      (mode.history as unknown as HistoryEntry<S>[]).length > 0,
    teams,
  };
}

/**
 * Saves a draft. `expectedRevision` is the revision the editor loaded: if
 * someone else saved since, nothing is overwritten.
 */
export async function saveModeDraft<C, S, A extends { type: string }, E>(
  module: ModeModule<C, S, A, E>,
  {
    gameId,
    draft,
    expectedRevision,
  }: { gameId: string; draft: unknown; expectedRevision: number },
): Promise<Result<{ draftRevision: number }, GameKitError>> {
  const parsed = module.parseDraft(draft);
  if (parsed.isErr()) {
    return err({ kind: "invalidContent", issues: parsed.error.slice(0, 10) });
  }
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const mode = await tx.gameMode.findUnique({ where: { gameId } });
      if (mode && mode.kind !== module.kind) {
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
          kind: module.kind,
          draft: json(parsed.value),
          draftRevision: 1,
        },
        update: { draft: json(parsed.value), draftRevision: { increment: 1 } },
      });
      return ok({ draftRevision: saved.draftRevision });
    }),
  );
}

/** Freezes the draft and starts play. Blocking preflight problems refuse. */
export async function startModeSession<C, S, A extends { type: string }, E>(
  module: ModeModule<C, S, A, E>,
  gameId: string,
): Promise<Result<{ step: number }, GameKitError>> {
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
          problems: ["Set it up and save it first."],
        });
      }
      if (mode.kind !== module.kind) {
        return err({ kind: "otherMode", mode: mode.kind });
      }
      if (mode.status !== "draft") return err({ kind: "modeAlreadyStarted" });
      const parsed = module.parseDraft(mode.draft);
      if (parsed.isErr()) {
        return err({ kind: "invalidContent", issues: parsed.error });
      }
      const check = module.preflight(parsed.value, teams);
      if (check.blocking.length > 0) {
        return err({ kind: "preflightBlocked", problems: check.blocking });
      }
      await tx.gameMode.update({
        where: { gameId },
        data: {
          status: "running",
          content: json(parsed.value),
          state: json(module.initialState(teams.map((t) => t.id))),
          history: [],
          step: 1,
          startedAt: new Date(),
        },
      });
      // Starting a mode starts the game, as opening the buzzer does.
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

/**
 * The scoreboard's own undo stops here: it can't step back into points a
 * mode gave (that would change scores without the board). Earlier states
 * stay stored as history; they just aren't undoable.
 */
async function scoreHistoryBarrier(tx: GameTx, gameId: string) {
  await tx.scoreboard.updateMany({
    where: { gameId },
    data: { pastStateIds: [], futureStateIds: [] },
  });
}

/**
 * Adds points through the shared score writer, skipping teams deleted
 * since; returns what was applied and sets the history barrier.
 */
async function applyModeScores(
  tx: GameTx,
  gameId: string,
  actorUserId: string,
  requestId: string,
  scores: Record<string, number>,
): Promise<Result<Record<string, number>, GameKitError>> {
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
  if (result.isErr()) return err(result.error);
  await scoreHistoryBarrier(tx, gameId);
  return ok(changes);
}

/**
 * Applies one host action. `expectedStep` is the step the host's screen
 * showed: if another host acted first, nothing happens. A retried request
 * (same `requestId`) is a no-op.
 */
export async function actInModeSession<C, S, A extends { type: string }, E>(
  module: ModeModule<C, S, A, E>,
  {
    gameId,
    actorUserId,
    action,
    expectedStep,
    requestId,
  }: {
    gameId: string;
    actorUserId: string;
    action: A;
    expectedStep: number;
    requestId: string;
  },
): Promise<Result<{ step: number; replayed: boolean }, GameKitError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const [replay, mode] = await Promise.all([
        tx.gameOperation.findUnique({
          where: { gameId_requestId: { gameId, requestId } },
        }),
        tx.gameMode.findUnique({ where: { gameId } }),
      ]);
      if (replay) return ok({ step: mode?.step ?? 0, replayed: true });
      if (mode?.status !== "running" || mode.kind !== module.kind) {
        return err({ kind: "modeNotRunning" });
      }
      if (mode.step !== expectedStep) {
        return err({ kind: "stepConflict", step: mode.step });
      }
      const content = module.parseDraft(mode.content);
      if (content.isErr()) {
        return err({ kind: "invalidContent", issues: content.error });
      }
      const stored = mode.state as S;
      const teams = (await teamsInOrder(tx, gameId)).map((t) => t.id);
      const step = module.apply(
        content.value,
        module.withTeams(stored, action, teams),
        action,
      );
      if (step.isErr()) return err(module.ruleError(step.error));
      const scored = await applyModeScores(
        tx,
        gameId,
        actorUserId,
        requestId,
        step.value.scores,
      );
      if (scored.isErr()) return err(scored.error);
      // Undo reverses exactly what was applied.
      const history = [
        ...(mode.history as unknown as HistoryEntry<S>[]),
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
          action: `${module.kind}.${action.type}`.slice(0, 64),
          actorUserId,
          payloadHash: hash(action),
          result: json({ step: mode.step + 1, scores: scored.value }),
        },
      });
      return ok({ step: mode.step + 1, replayed: false });
    }),
  );
}

/** Undoes the last action and takes back the points it applied, in one go. */
export async function undoInModeSession<C, S, A extends { type: string }, E>(
  module: ModeModule<C, S, A, E>,
  {
    gameId,
    actorUserId,
    expectedStep,
    requestId,
  }: {
    gameId: string;
    actorUserId: string;
    expectedStep: number;
    requestId: string;
  },
): Promise<Result<{ step: number }, GameKitError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const mode = await tx.gameMode.findUnique({ where: { gameId } });
      if (mode?.status !== "running" || mode.kind !== module.kind) {
        return err({ kind: "modeNotRunning" });
      }
      if (mode.step !== expectedStep) {
        return err({ kind: "stepConflict", step: mode.step });
      }
      const history = mode.history as unknown as HistoryEntry<S>[];
      const last = history.at(-1);
      if (!last) return err({ kind: "nothingToUndoInMode" });
      const reverse = Object.fromEntries(
        Object.entries(last.scores).map(([t, p]) => [t, -p]),
      );
      const scored = await applyModeScores(
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
          state: json(module.undo(mode.state as S, last.state)),
          history: json(history.slice(0, -1)),
          step: { increment: 1 },
        },
      });
      return ok({ step: mode.step + 1 });
    }),
  );
}

/**
 * "Use basic controls" (W23): in one transaction the mode ends for good in
 * this room, the buzzer closes (nothing reopens by itself), and the
 * scoreboard's undo is limited to changes made after this point. Players,
 * teams, chat and scores stay. Works for any mode kind.
 */
export async function handOffToBasic(
  gameId: string,
  actorUserId: string | null,
  kind?: ModeKind,
): Promise<Result<{ changed: boolean }, GameKitError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const { count } = await tx.gameMode.updateMany({
        where: { gameId, status: "running", ...(kind ? { kind } : {}) },
        data: { status: "ended", endedAt: new Date() },
      });
      if (count === 0)
        return ok<{ changed: boolean }, GameKitError>({ changed: false });
      await tx.game.update({
        where: { id: gameId },
        data: { isBuzzerListening: false },
      });
      await scoreHistoryBarrier(tx, gameId);
      await tx.gameOperation.create({
        data: {
          gameId,
          requestId: `handoff-${randomUUID()}`,
          action: "mode.handoff",
          actorUserId,
          payloadHash: hash({ kind: kind ?? "any" }),
          result: json({}),
        },
      });
      return ok<{ changed: boolean }, GameKitError>({ changed: true });
    }),
  );
}

/** Throws away an unstarted draft of this kind. A started mode's record is kept. */
export async function discardModeDraft(
  kind: ModeKind,
  gameId: string,
): Promise<Result<{ changed: boolean }, GameKitError>> {
  return flatten(
    await withGameLock(gameId, async (tx) => {
      const { count } = await tx.gameMode.deleteMany({
        where: { gameId, kind, status: "draft" },
      });
      return ok<{ changed: boolean }, GameKitError>({ changed: count > 0 });
    }),
  );
}
