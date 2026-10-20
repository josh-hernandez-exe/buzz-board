import { describe, expect, it } from "vitest";

import {
  addScores,
  diffScores,
  parseScoreMap,
  SCORE_LIMITS,
  setScores,
} from "./scoreMath";

describe("addScores", () => {
  it("adds positive, negative and zero amounts and reports actual deltas", () => {
    const result = addScores({ a: 10, b: 5 }, { a: 3, b: -5, c: 0 });

    expect(result._unsafeUnwrap()).toEqual({
      scores: { a: 13, b: 0, c: 0 },
      effects: [
        { gameTeamId: "a", delta: 3, scoreBefore: 10, scoreAfter: 13 },
        { gameTeamId: "b", delta: -5, scoreBefore: 5, scoreAfter: 0 },
      ],
    });
  });

  it("treats a unit missing from a legacy state as 0", () => {
    expect(addScores({}, { a: 4 })._unsafeUnwrap().scores).toEqual({ a: 4 });
  });

  it("keeps a legacy fractional opening balance exact", () => {
    const { scores, effects } = addScores({ a: 1.5 }, { a: 2 })._unsafeUnwrap();

    expect(scores.a).toBe(3.5);
    expect(effects[0]).toMatchObject({ scoreBefore: 1.5, delta: 2 });
  });

  it.each([
    [1.5, "a fraction"],
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "infinity"],
    [SCORE_LIMITS.maxAbsDelta + 1, "an amount above the limit"],
    [-(SCORE_LIMITS.maxAbsDelta + 1), "an amount below the limit"],
  ])("rejects %s (%s)", (amount) => {
    expect(addScores({ a: 0 }, { a: amount })._unsafeUnwrapErr()).toEqual({
      kind: "invalidAmount",
      gameTeamId: "a",
      value: amount,
    });
  });

  it("accepts amounts exactly at the limit", () => {
    expect(addScores({ a: 0 }, { a: SCORE_LIMITS.maxAbsDelta }).isOk()).toBe(
      true,
    );
  });

  it("rejects a result outside the score range", () => {
    expect(
      addScores({ a: SCORE_LIMITS.maxAbsScore }, { a: 1 })._unsafeUnwrapErr(),
    ).toEqual({
      kind: "scoreOutOfRange",
      gameTeamId: "a",
      value: SCORE_LIMITS.maxAbsScore + 1,
    });
  });

  it("requires at least one unit", () => {
    expect(addScores({ a: 1 }, {})._unsafeUnwrapErr()).toEqual({
      kind: "noChanges",
    });
  });
});

describe("setScores", () => {
  it("sets zero and negative values", () => {
    const { scores, effects } = setScores(
      { a: 25, b: 25 },
      { a: 0, b: -3 },
    )._unsafeUnwrap();

    expect(scores).toEqual({ a: 0, b: -3 });
    expect(effects.map((e) => e.delta)).toEqual([-25, -28]);
  });

  it("reports no effect when the value is unchanged", () => {
    expect(setScores({ a: 7 }, { a: 7 })._unsafeUnwrap().effects).toEqual([]);
  });

  it("rejects values outside the score range", () => {
    expect(setScores({}, { a: SCORE_LIMITS.maxAbsScore + 1 }).isErr()).toBe(
      true,
    );
  });
});

describe("diffScores", () => {
  it("covers units present in either state, in a stable order", () => {
    expect(diffScores({ b: 2, a: 1 }, { a: 1, c: 4 })).toEqual([
      { gameTeamId: "b", delta: -2, scoreBefore: 2, scoreAfter: 0 },
      { gameTeamId: "c", delta: 4, scoreBefore: 0, scoreAfter: 4 },
    ]);
  });
});

describe("parseScoreMap", () => {
  it("drops non-numeric legacy values and tolerates non-object state", () => {
    expect(parseScoreMap({ a: 1, b: "x", c: null })).toEqual({ a: 1 });
    expect(parseScoreMap(null)).toEqual({});
    expect(parseScoreMap([1, 2])).toEqual({});
  });
});
