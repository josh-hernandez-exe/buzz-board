/**
 * PR13: worked examples of the proposed Ranked Answers rules
 * (docs/pr13-ranked-answers-event-spec.md), run against a small reference
 * model. Review aids for the owner, and the future mode's acceptance tests.
 */
import { describe, expect, it } from "vitest";

import pack from "../fixtures/ranked-answers/synthetic-pack.json";
import {
  boardTotal,
  faceOffPair,
  faceOffWinner,
  secretFaceOffWinner,
  playAllPlay,
  playFaceOffBoard,
  playRoundRobin,
  pointsFor,
  preflight,
  turnOrder,
  type Board,
  type Outcome,
  type Rules,
} from "../fixtures/ranked-answers/referenceModel";

const rules = pack.rules as Rules;
const boards = pack.boards as Board[];
const board = (id: string) => boards.find((b) => b.id === id)!;
const row = (b: Board, id: string) => b.answers.find((a) => a.id === id)!;
const accept = (answerId: string): Outcome => ({ kind: "accept", answerId });
const miss: Outcome = { kind: "miss" };
const six = ["T1", "T2", "T3", "T4", "T5", "T6"];
const withStyle = (playStyle: Rules["playStyle"]): Rules => ({
  ...rules,
  playStyle,
});

describe("synthetic pack", () => {
  it("passes preflight for every style it's meant for", () => {
    expect(preflight(withStyle("classic"), boards, 2).blocking).toEqual([]);
    expect(preflight(withStyle("faceOffLadder"), boards, 6).blocking).toEqual(
      [],
    );
    expect(preflight(withStyle("roundRobin"), boards, 3).blocking).toEqual([]);
    expect(preflight(withStyle("allPlay"), boards, 12).blocking).toEqual([]);
  });

  it("is clearly synthetic, with practice, main and spare boards", () => {
    expect(boards.every((b) => b.source.kind === "synthetic")).toBe(true);
    expect(boards.map((b) => b.role)).toEqual([
      "practice",
      "main",
      "main",
      "main",
      "spare",
    ]);
  });
});

describe("points are configurable", () => {
  it("defaults to 30/25/20/15/10/8/5/2: an eight-row board is worth 115", () => {
    expect(boardTotal(rules, board("board-picnic"))).toBe(115);
  });

  it("takes game-wide rank points, a per-board multiplier, or per-row counts", () => {
    const custom: Rules = { ...rules, pointValuesByRank: [100, 50, 25, 10] };
    expect(
      pointsFor(
        custom,
        board("spare-breakfast"),
        row(board("spare-breakfast"), "toast"),
      ),
    ).toBe(100);
    // "Double points" board scored with survey-style counts: 38 × 2.
    const dinner = board("board-holiday-dinner");
    expect(pointsFor(rules, dinner, row(dinner, "turkey"))).toBe(76);
    expect(boardTotal(rules, dinner)).toBe((38 + 22 + 14 + 11 + 8 + 4) * 2);
  });

  it("blocks rank points that don't decrease, and row counts that go up", () => {
    const bad = preflight(
      { ...rules, pointValuesByRank: [30, 30, 20] },
      [
        {
          ...board("spare-breakfast"),
          answers: board("spare-breakfast").answers.map((a, i) => ({
            ...a,
            points: [10, 20, 5, 1][i],
          })),
        },
      ],
      3,
    );
    expect(bad.blocking).toContain(
      "rank points must be positive and strictly decreasing",
    );
    expect(bad.blocking).toContain(
      "spare-breakfast: row points must be positive and never higher than the row above",
    );
  });
});

describe("styles match team counts", () => {
  it("blocks a style that doesn't fit the number of teams", () => {
    expect(preflight(withStyle("classic"), boards, 3).blocking[0]).toBe(
      "classic needs 2 teams; this game has 3",
    );
    expect(preflight(withStyle("faceOffLadder"), boards, 2).blocking[0]).toBe(
      "faceOffLadder needs 3 to 8 teams; this game has 2",
    );
    expect(preflight(withStyle("allPlay"), boards, 40).blocking).toEqual([]);
  });

  it("warns, without blocking, when boards don't share turns evenly", () => {
    const { warnings } = preflight(withStyle("roundRobin"), boards, 6);
    expect(warnings).toContain(
      "3 boards don't give each of 6 teams the same number of first turns",
    );
  });
});

describe("classic: 2 teams, like the TV show", () => {
  const b = board("board-picnic");

  it("decides the face-off: top row wins at once, else the higher row", () => {
    expect(faceOffWinner(b, { team: "A", answerId: "blanket" }, null)).toBe(
      "A",
    );
    expect(
      faceOffWinner(
        b,
        { team: "A", answerId: "fruit" },
        { team: "B", answerId: "water" },
      ),
    ).toBe("B");
    expect(
      faceOffWinner(
        b,
        { team: "A", answerId: null },
        { team: "B", answerId: null },
      ),
    ).toBeNull();
  });

  it("can face off secretly instead, so connection speed never decides", () => {
    expect(
      secretFaceOffWinner(
        b,
        { team: "A", answerId: "fruit" },
        { team: "B", answerId: "water" },
      ),
    ).toBe("B");
    expect(
      secretFaceOffWinner(
        b,
        { team: "A", answerId: "water" },
        { team: "B", answerId: "water" },
      ),
    ).toBeNull();
  });

  it("the controlling team clears the board and takes the bank", () => {
    const result = playFaceOffBoard(rules, b, ["A", "B"], {
      faceOffRows: ["water"],
      control: "B",
      controlAnswers: [
        accept("blanket"),
        miss,
        accept("sandwiches"),
        accept("fruit"),
        accept("sunscreen"),
        accept("napkins"),
        miss,
        accept("games"),
        accept("umbrella"),
      ],
      steals: {},
    });
    expect(result.bankWinners).toEqual(["B"]);
    expect(result.points).toEqual({ A: 0, B: 115 });
    expect(result.strikes).toBe(2);
  });

  it("after three strikes the other team steals the whole bank with one hidden row", () => {
    const result = playFaceOffBoard(rules, b, ["A", "B"], {
      faceOffRows: ["blanket"],
      control: "A",
      controlAnswers: [accept("water"), miss, miss, miss, accept("fruit")],
      steals: { B: accept("sandwiches") },
    });
    // Bank: blanket 30 + water 20; steal adds sandwiches 25.
    expect(result).toMatchObject({
      strikes: 3,
      bank: 50,
      bankWinners: ["B"],
      points: { A: 0, B: 75 },
    });
    expect(result.revealed).not.toContain("fruit");
  });

  it("a failed steal gives the bank to the controlling team", () => {
    const result = playFaceOffBoard(rules, b, ["A", "B"], {
      faceOffRows: ["blanket"],
      control: "A",
      controlAnswers: [miss, miss, miss],
      steals: { B: accept("blanket") },
    });
    expect(result).toMatchObject({
      bankWinners: ["A"],
      points: { A: 30, B: 0 },
    });
  });
});

describe("face-off ladder: 3 to 8 teams", () => {
  const b = board("board-picnic");

  it("rotates face-off pairs so every team gets the stage", () => {
    expect([0, 1, 2].map((i) => faceOffPair(six, i))).toEqual([
      ["T1", "T2"],
      ["T3", "T4"],
      ["T5", "T6"],
    ]);
    expect(faceOffPair(["A", "B", "C"], 1)).toEqual(["C", "A"]);
  });

  it("every other team steals at once; the highest row takes the bank, others score their row", () => {
    const result = playFaceOffBoard(rules, b, six, {
      faceOffRows: ["blanket"],
      control: "T1",
      controlAnswers: [miss, miss, miss],
      steals: {
        T2: accept("fruit"),
        T3: accept("sandwiches"),
        T4: accept("blanket"), // already revealed: nothing
        T5: miss,
        T6: accept("umbrella"),
      },
    });
    expect(result.bankWinners).toEqual(["T3"]);
    expect(result.points).toEqual({
      T1: 0,
      T2: 15,
      T3: 30 + 25,
      T4: 0,
      T5: 0,
      T6: 2,
    });
  });

  it("teams tying on the best steal row both take the bank", () => {
    const result = playFaceOffBoard(rules, b, ["A", "B", "C"], {
      faceOffRows: ["blanket"],
      control: "A",
      controlAnswers: [miss, miss, miss],
      steals: { B: accept("water"), C: accept("water") },
    });
    expect(result.bankWinners).toEqual(["B", "C"]);
    expect(result.points).toEqual({ A: 0, B: 50, C: 50 });
  });
});

describe("round robin: 2+ teams take turns", () => {
  it("rotates the starting team each board, whatever the scores", () => {
    expect(turnOrder(six, 1)).toEqual(["T2", "T3", "T4", "T5", "T6", "T1"]);
    expect(turnOrder(six, 6)).toEqual(six);
  });

  it("gives six teams 12 turns; misses and duplicates use the turn for 0", () => {
    const result = playRoundRobin(rules, board("board-rainy-day"), six, [
      accept("baking"),
      miss,
      accept("baking"),
      { kind: "timeout" },
      accept("movie"),
      { kind: "pass" },
      ...Array.from({ length: 6 }, () => miss),
      accept("reading"),
    ]);
    expect(result.turnsUsed).toBe(12);
    expect(result.points).toEqual({
      T1: 20,
      T2: 0,
      T3: 0,
      T4: 0,
      T5: 30,
      T6: 0,
    });
    expect(result.leftovers).toEqual([
      "board-game",
      "reading",
      "puzzle",
      "crafts",
    ]);
  });

  it("closes once every row is found, so later teams may not act", () => {
    const result = playRoundRobin(
      rules,
      board("spare-breakfast"),
      six,
      ["toast", "cereal", "eggs", "pancakes"].map(accept),
    );
    expect(result).toMatchObject({ closedBy: "allFound", turnsUsed: 4 });
  });
});

describe("all-play: any number of teams answer at once", () => {
  it("scores every team that finds a row still hidden, even the same row", () => {
    const teams = Array.from({ length: 10 }, (_, i) => `T${i + 1}`);
    const b = board("board-rainy-day");
    const result = playAllPlay(rules, b, teams, [
      { T1: "movie", T2: "movie", T3: "baking", T4: null, T5: "nope" },
      { T1: "movie", T6: "reading", T7: "puzzle" },
    ]);
    expect(result.points).toMatchObject({
      T1: 30, // movie in round 1; movie again in round 2 scores 0
      T2: 30,
      T3: 20,
      T4: 0,
      T5: 0,
      T6: 15,
      T7: 10,
    });
    expect(result.turnsUsed).toBe(2);
    expect(result.leftovers).toEqual(["board-game", "crafts"]);
  });

  it("stops after the configured rounds", () => {
    const result = playAllPlay(
      { ...rules, allPlayRounds: 1 },
      board("spare-breakfast"),
      ["A", "B"],
      [{ A: "toast" }, { B: "eggs" }],
    );
    expect(result.points).toEqual({ A: 30, B: 0 });
  });
});
