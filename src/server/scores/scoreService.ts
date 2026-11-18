import { createHash } from "node:crypto";

import { GameStatus, type Prisma } from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import {
  withGameLock,
  type GameTransactionError,
  type GameTx,
} from "@/server/db/gameTransaction";
import {
  addScores,
  diffScores,
  parseScoreMap,
  setScores,
  type ScoreEffectDraft,
  type ScoreMap,
  type ScoreMathError,
} from "@/server/scores/scoreMath";

export type ScoreCommand =
  | { kind: "add"; changes: ScoreMap }
  | { kind: "set"; changes: ScoreMap }
  | { kind: "undo" }
  | { kind: "redo" };

export type ScoreCommandResult = {
  operationId: string;
  /** True when this request ID was already committed and nothing was applied. */
  replayed: boolean;
  scoreboardStateId: string;
  /** The actual change applied to each unit (empty when nothing changed). */
  effects: ScoreEffectDraft[];
};

export type ScoreCommandError =
  | GameTransactionError
  | ScoreMathError
  | { kind: "scoreboardNotFound" }
  | { kind: "unknownTeams"; gameTeamIds: string[] }
  | { kind: "nothingToUndo" }
  | { kind: "nothingToRedo" }
  | { kind: "historyCorrupt"; stateId: string }
  /** Scores are read-only after finish; reopen the game to correct them. */
  | { kind: "gameFinished" }
  /** The request ID was already used for a different command or actor. */
  | { kind: "requestIdReused"; requestId: string };

const ACTION: Record<ScoreCommand["kind"], string> = {
  add: "score.add",
  set: "score.set",
  undo: "score.undo",
  redo: "score.redo",
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

export function payloadHash(command: ScoreCommand): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(command)))
    .digest("hex");
}

function stateIds(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

type StoredResult = {
  scoreboardStateId: string;
  effects: ScoreEffectDraft[];
};

/**
 * Applies one manual score command for a game: the only write path for
 * current scores and their history.
 *
 * In one transaction holding the game's lock it reads the current state,
 * writes the next state and history pointers, records an operation receipt and
 * the actual per-unit deltas. A retry of a committed `requestId` by the same
 * actor with the same command returns the original result without applying it
 * again.
 */
export async function runScoreCommand({
  gameId,
  actorUserId,
  requestId,
  command,
}: {
  gameId: string;
  actorUserId: string | null;
  requestId: string;
  command: ScoreCommand;
}): Promise<Result<ScoreCommandResult, ScoreCommandError>> {
  const outcome = await withGameLock(gameId, (tx) =>
    scoreCommandInTx(tx, { gameId, actorUserId, requestId, command }),
  );
  return outcome.isErr() ? err(outcome.error) : outcome.value;
}

/**
 * The body of runScoreCommand, for callers that already hold the game lock
 * and must change scores in the same transaction as their own state (for
 * example a game mode revealing an answer and awarding its points).
 */
export async function scoreCommandInTx(
  tx: GameTx,
  {
    gameId,
    actorUserId,
    requestId,
    command,
  }: {
    gameId: string;
    actorUserId: string | null;
    requestId: string;
    command: ScoreCommand;
  },
): Promise<Result<ScoreCommandResult, ScoreCommandError>> {
  const action = ACTION[command.kind];
  const hash = payloadHash(command);
  const existing = await tx.gameOperation.findUnique({
    where: { gameId_requestId: { gameId, requestId } },
  });
  if (existing) {
    if (
      existing.action !== action ||
      existing.actorUserId !== actorUserId ||
      existing.payloadHash !== hash
    ) {
      return err<ScoreCommandResult, ScoreCommandError>({
        kind: "requestIdReused",
        requestId,
      });
    }
    const stored = existing.result as StoredResult;
    return ok<ScoreCommandResult, ScoreCommandError>({
      operationId: existing.id,
      replayed: true,
      scoreboardStateId: stored.scoreboardStateId,
      effects: stored.effects,
    });
  }

  const planned = await planCommand(tx, gameId, command);
  if (planned.isErr()) return err(planned.error);
  const plan = planned.value;

  let scoreboardStateId = plan.currentStateId;
  if (plan.kind === "newState") {
    const state = await tx.scoreboardState.create({
      data: {
        gameId,
        scoreboardId: plan.scoreboardId,
        state: plan.scores,
      },
    });
    scoreboardStateId = state.id;
    await tx.scoreboard.update({
      where: { id: plan.scoreboardId },
      data: {
        currentStateId: state.id,
        pastStateIds: [...plan.pastStateIds, plan.currentStateId],
        futureStateIds: [],
      },
    });
  } else if (plan.kind === "move") {
    scoreboardStateId = plan.targetStateId;
    await tx.scoreboard.update({
      where: { id: plan.scoreboardId },
      data: {
        currentStateId: plan.targetStateId,
        pastStateIds: plan.pastStateIds,
        futureStateIds: plan.futureStateIds,
      },
    });
  }

  const stored: StoredResult = { scoreboardStateId, effects: plan.effects };
  const operation = await tx.gameOperation.create({
    data: {
      gameId,
      requestId,
      action,
      actorUserId,
      payloadHash: hash,
      result: stored,
    },
  });
  if (plan.effects.length > 0) {
    await tx.scoreEffect.createMany({
      data: plan.effects.map((effect) => ({
        ...effect,
        gameId,
        operationId: operation.id,
        scoreboardStateId,
      })),
    });
  }

  return ok<ScoreCommandResult, ScoreCommandError>({
    operationId: operation.id,
    replayed: false,
    ...stored,
  });
}

type Plan = { scoreboardId: string; currentStateId: string } & (
  | {
      kind: "newState";
      scores: ScoreMap;
      pastStateIds: string[];
      effects: ScoreEffectDraft[];
    }
  | {
      kind: "move";
      targetStateId: string;
      pastStateIds: string[];
      futureStateIds: string[];
      effects: ScoreEffectDraft[];
    }
  | { kind: "unchanged"; effects: [] }
);

async function planCommand(
  tx: GameTx,
  gameId: string,
  command: ScoreCommand,
): Promise<Result<Plan, ScoreCommandError>> {
  const game = await tx.game.findUniqueOrThrow({
    where: { id: gameId },
    select: { status: true },
  });
  if (game.status === GameStatus.finished) {
    return err({ kind: "gameFinished" });
  }

  const scoreboard = await tx.scoreboard.findUnique({
    where: { gameId },
    include: { currentState: true },
  });
  if (!scoreboard?.currentState) {
    return err({ kind: "scoreboardNotFound" });
  }
  const base = {
    scoreboardId: scoreboard.id,
    currentStateId: scoreboard.currentState.id,
  };
  const current = parseScoreMap(scoreboard.currentState.state);
  const past = stateIds(scoreboard.pastStateIds);
  const future = stateIds(scoreboard.futureStateIds);

  if (command.kind === "add" || command.kind === "set") {
    const ids = Object.keys(command.changes);
    const teams = await tx.gameTeam.findMany({
      where: { gameId, id: { in: ids } },
      select: { id: true },
    });
    const known = new Set(teams.map((t) => t.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return err({ kind: "unknownTeams", gameTeamIds: unknown });
    }

    const applied = (command.kind === "add" ? addScores : setScores)(
      current,
      command.changes,
    );
    if (applied.isErr()) return err(applied.error);
    if (applied.value.effects.length === 0) {
      // Nothing changes: record the receipt but do not add an empty undo step.
      return ok({ ...base, kind: "unchanged", effects: [] });
    }
    return ok({
      ...base,
      kind: "newState",
      scores: applied.value.scores,
      pastStateIds: past,
      effects: applied.value.effects,
    });
  }

  // History is a stack of state IDs: `past` ends with the previous state and
  // `future[0]` is the next state to redo.
  const targetStateId = command.kind === "undo" ? past.at(-1) : future.at(0);
  if (targetStateId === undefined) {
    return err({
      kind: command.kind === "undo" ? "nothingToUndo" : "nothingToRedo",
    });
  }
  const target = await tx.scoreboardState.findFirst({
    where: { id: targetStateId, scoreboardId: scoreboard.id },
  });
  if (!target) {
    return err({ kind: "historyCorrupt", stateId: targetStateId });
  }

  return ok({
    ...base,
    kind: "move",
    targetStateId,
    pastStateIds:
      command.kind === "undo"
        ? past.slice(0, -1)
        : [...past, scoreboard.currentState.id],
    futureStateIds:
      command.kind === "undo"
        ? [scoreboard.currentState.id, ...future]
        : future.slice(1),
    effects: diffScores(current, parseScoreMap(target.state)),
  });
}
