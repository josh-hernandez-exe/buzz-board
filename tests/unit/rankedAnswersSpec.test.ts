/**
 * PR13: the synthetic Ranked Answers fixture satisfies the proposed rules,
 * and the rules' worked examples (docs/pr13-ranked-answers-event-spec.md)
 * hold. These are review aids for the owner, not the runtime.
 */
import { describe, expect, it } from "vitest";

import pack from "../fixtures/ranked-answers/synthetic-pack.json";
import {
  playBoard,
  pointsFor,
  rulesProblems,
  turnOrder,
  type Board,
  type Rules,
} from "../fixtures/ranked-answers/referenceModel";

const rules: Rules = pack.rules;
const boards = pack.boards as Board[];
const board = (id: string) => boards.find((b) => b.id === id)!;
const teams = ["T1", "T2", "T3", "T4", "T5", "T6"];

describe("synthetic pack", () => {
  it("passes every proposed preflight rule", () => {
    expect(rulesProblems(rules, boards)).toEqual([]);
  });

  it("is clearly synthetic: no captured source, practice and spare boards included", () => {
    expect(boards.every((b) => b.source.kind === "synthetic")).toBe(true);
    expect(boards.map((b) => b.role)).toEqual([
      "practice",
      "main",
      "main",
      "spare",
    ]);
  });

  it("uses the plan's defaults", () => {
    expect(rules).toEqual({
      turnCycles: 2,
      consultationSeconds: 10,
      answerSeconds: 5,
      roundTargetSeconds: 360,
      pointValuesByRank: [30, 25, 20, 15, 10, 8, 5, 2],
      multiplier: 1,
    });
  });
});

describe("preflight blocks broken rules and boards", () => {
  it("rejects weights that aren't strictly decreasing, and short or gappy boards", () => {
    const bad: Rules = { ...rules, pointValuesByRank: [30, 30, 20, 0] };
    const problems = rulesProblems(bad, [
      { ...board("board-picnic") },
      {
        ...board("spare-breakfast"),
        answers: board("spare-breakfast").answers.slice(0, 3),
      },
    ]);
    expect(problems).toContain(
      "rank points must be positive and strictly decreasing",
    );
    expect(problems).toContain("board-picnic: more rows than rank points");
    expect(problems).toContain("spare-breakfast: needs 4 to 8 answers");
  });
});

describe("worked examples", () => {
  it("an eight-row board is worth at most 115 points, not a percentage", () => {
    const total = board("board-picnic").answers.reduce(
      (sum, a) => sum + pointsFor(rules, a.rank),
      0,
    );
    expect(total).toBe(115);
    expect(pointsFor({ ...rules, multiplier: 2 }, 1)).toBe(60);
  });

  it("rotates the starting team each board, whatever the scores", () => {
    expect(turnOrder(teams, 0)).toEqual(teams);
    expect(turnOrder(teams, 1)).toEqual(["T2", "T3", "T4", "T5", "T6", "T1"]);
    expect(turnOrder(teams, 6)).toEqual(teams);
  });

  it("gives six teams up to 12 turns; misses and duplicates score zero and use the turn", () => {
    const order = turnOrder(teams, 0);
    const result = playBoard(rules, board("board-rainy-day"), order, [
      { kind: "accept", answerId: "baking" }, // T1: rank 3 → 20
      { kind: "miss" }, // T2
      { kind: "accept", answerId: "baking" }, // T3: duplicate → 0
      { kind: "timeout" }, // T4
      { kind: "accept", answerId: "movie" }, // T5: rank 1 → 30
      { kind: "pass" }, // T6
      ...Array.from({ length: 6 }, () => ({ kind: "miss" as const })),
      { kind: "accept", answerId: "reading" }, // a 13th outcome never happens
    ]);
    expect(result.turnsUsed).toBe(12);
    expect(result.closedBy).toBe("outOfTurns");
    expect(result.points).toEqual({
      T1: 20,
      T2: 0,
      T3: 0,
      T4: 0,
      T5: 30,
      T6: 0,
    });
    // Leftovers are revealed for zero, in rank order.
    expect(result.leftovers).toEqual([
      "board-game",
      "reading",
      "puzzle",
      "crafts",
    ]);
  });

  it("closes as soon as every row is found, so later teams may not act (starter fairness)", () => {
    const result = playBoard(
      rules,
      board("spare-breakfast"),
      turnOrder(teams, 0),
      ["toast", "cereal", "eggs", "pancakes"].map((answerId) => ({
        kind: "accept" as const,
        answerId,
      })),
    );
    expect(result.closedBy).toBe("allFound");
    expect(result.turnsUsed).toBe(4);
    expect(result.points.T5).toBe(0);
    expect(result.points.T6).toBe(0);
  });

  it("lets the host close for time; remaining rows are revealed for zero", () => {
    const result = playBoard(
      rules,
      board("board-picnic"),
      turnOrder(teams, 0),
      Array.from({ length: 12 }, () => ({ kind: "miss" as const })),
      3,
    );
    expect(result).toMatchObject({ closedBy: "host", turnsUsed: 3 });
    expect(result.leftovers).toHaveLength(8);
  });
});
