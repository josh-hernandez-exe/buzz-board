import { err, ok, type Result } from "neverthrow";

/** Scores keyed by scoring unit (team, or an individual's backing team). */
export type ScoreMap = Record<string, number>;

export const SCORE_LIMITS = {
  /** Largest amount a single add/subtract may change one unit by. */
  maxAbsDelta: 1_000_000,
  /** Largest absolute score a unit may hold after a change. */
  maxAbsScore: 1_000_000_000,
} as const;

export type ScoreEffectDraft = {
  gameTeamId: string;
  delta: number;
  scoreBefore: number;
  scoreAfter: number;
};

export type ScoreMathError =
  | { kind: "noChanges" }
  | { kind: "invalidAmount"; gameTeamId: string; value: number }
  | { kind: "scoreOutOfRange"; gameTeamId: string; value: number };

/**
 * Legacy states may omit a unit (meaning 0) or hold a non-finite value written
 * by an old client; both read as 0 so they cannot poison new arithmetic.
 */
export function scoreOf(scores: ScoreMap, gameTeamId: string): number {
  const value = scores[gameTeamId];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseScoreMap(state: unknown): ScoreMap {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  const scores: ScoreMap = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      scores[key] = value;
    }
  }
  return scores;
}

function checkAmount(
  gameTeamId: string,
  value: number,
  limit: number,
): Result<number, ScoreMathError> {
  if (!Number.isInteger(value) || Math.abs(value) > limit) {
    return err({ kind: "invalidAmount", gameTeamId, value });
  }
  return ok(value);
}

function checkResult(
  gameTeamId: string,
  value: number,
): Result<number, ScoreMathError> {
  if (Math.abs(value) > SCORE_LIMITS.maxAbsScore) {
    return err({ kind: "scoreOutOfRange", gameTeamId, value });
  }
  return ok(value);
}

/** Effects for every unit whose score differs between two states. */
export function diffScores(
  before: ScoreMap,
  after: ScoreMap,
): ScoreEffectDraft[] {
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return ids
    .sort()
    .map((gameTeamId) => {
      const scoreBefore = scoreOf(before, gameTeamId);
      const scoreAfter = scoreOf(after, gameTeamId);
      return {
        gameTeamId,
        scoreBefore,
        scoreAfter,
        delta: scoreAfter - scoreBefore,
      };
    })
    .filter((effect) => effect.delta !== 0);
}

function applyEach(
  current: ScoreMap,
  changes: ScoreMap,
  next: (gameTeamId: string, amount: number) => Result<number, ScoreMathError>,
): Result<{ scores: ScoreMap; effects: ScoreEffectDraft[] }, ScoreMathError> {
  const entries = Object.entries(changes);
  if (entries.length === 0) {
    return err({ kind: "noChanges" });
  }

  const before = parseScoreMap(current);
  const scores: ScoreMap = { ...before };
  for (const [gameTeamId, amount] of entries) {
    const result = next(gameTeamId, amount);
    if (result.isErr()) return err(result.error);
    scores[gameTeamId] = result.value;
  }
  return ok({ scores, effects: diffScores(before, scores) });
}

/** Adds signed integer amounts. A zero amount is accepted and changes nothing. */
export function addScores(current: ScoreMap, changes: ScoreMap) {
  return applyEach(current, changes, (gameTeamId, amount) =>
    checkAmount(gameTeamId, amount, SCORE_LIMITS.maxAbsDelta).andThen((delta) =>
      checkResult(gameTeamId, scoreOf(current, gameTeamId) + delta),
    ),
  );
}

/** Sets absolute integer scores, including zero and negative values. */
export function setScores(current: ScoreMap, changes: ScoreMap) {
  return applyEach(current, changes, (gameTeamId, value) =>
    checkAmount(gameTeamId, value, SCORE_LIMITS.maxAbsScore),
  );
}
