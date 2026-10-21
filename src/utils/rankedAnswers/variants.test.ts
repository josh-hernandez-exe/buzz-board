/**
 * Every rule option and play style, one board at a time. The board's rows
 * are worth 50/40/30/20/10 so each test's points are easy to check.
 */
import { describe, expect, it } from "vitest";

import {
  contentSchema,
  optionsFor,
  preflight,
  PRESETS,
  presetRules,
  resolveRules,
  rulesSchema,
  type Content,
  type Rules,
} from "./content";
import {
  apply,
  initialState,
  stealersOf,
  type Action,
  type EngineState,
} from "./engine";
import { projectPublic } from "./projection";

const board = (id: string, role: "main" | "practice" | "spare" = "main") => ({
  id,
  role,
  prompt: `Board ${id}`,
  answers: [50, 40, 30, 20, 10].map((points, i) => ({
    id: `${id}-a${i + 1}`,
    text: `Answer ${i + 1}`,
    aliases: [],
    points,
  })),
});

function content(rules: Partial<Rules>): Content {
  return contentSchema.parse({
    rules: {
      playStyle: "classic",
      pointValuesByRank: [50, 40, 30, 20, 10],
      multiplier: 1,
      strikes: 3,
      turnCycles: 2,
      allPlayRounds: 3,
      faceOffMethod: "buzzer",
      ...rules,
    },
    boards: [board("b1"), board("b2"), board("p", "practice")],
  });
}

const a = (n: number, b = "b1") => `${b}-a${n}`;

function play(c: Content, teams: string[], actions: Action[]) {
  let state: EngineState = initialState(teams);
  const totals: Record<string, number> = Object.fromEntries(
    teams.map((t) => [t, 0]),
  );
  for (const action of actions) {
    const step = apply(c, state, action)._unsafeUnwrap();
    state = step.state;
    for (const [t, p] of Object.entries(step.scores)) totals[t]! += p;
  }
  return { state, totals, board: state.board! };
}

const two = ["A", "B"];
const four = ["A", "B", "C", "D"];
const start = (boardId = "b1"): Action => ({ type: "startBoard", boardId });
const answer = (n: number | null, b = "b1"): Action => ({
  type: "answer",
  answerId: n === null ? null : a(n, b),
});
const strikes = (k: number) => Array.from({ length: k }, () => answer(null));

describe("rule options", () => {
  it("fills in each style's defaults, so drafts saved before the options still load", () => {
    const old = rulesSchema.parse({
      playStyle: "faceOffLadder",
      pointValuesByRank: [30, 20, 10, 5],
      multiplier: 1,
      strikes: 3,
      turnCycles: 2,
      allPlayRounds: 3,
      faceOffMethod: "secret",
    });
    expect(resolveRules(old)).toMatchObject({
      stealBy: "everyone",
      allowPass: true,
      scoring: "bank",
      stealReward: "bankPlusRow",
      stealWinner: "bestRow",
      sharedAnswers: "full",
      raceLockout: "untilNextFind",
      missPenalty: 0,
      targetScore: null,
    });
    expect(resolveRules({ ...old, playStyle: "classic" }).stealBy).toBe(
      "opponent",
    );
  });

  it("every preset is valid and passes preflight at its smallest team count", () => {
    for (const preset of PRESETS) {
      const rules = presetRules(preset.id, preset.teams[0]);
      const c = contentSchema.parse({
        rules,
        boards: [board("b1"), board("s", "spare")],
      });
      expect(preflight(c, preset.teams[0]).blocking, preset.id).toEqual([]);
    }
  });

  it("only shows the options that matter for a style", () => {
    const o = optionsFor(presetRules("allPlay", 10));
    expect(o.sharedAnswers).toBe(true);
    expect(o.stealBy).toBe(false);
    expect(o.missPenalty).toBe(false);
    expect(optionsFor(presetRules("classic", 2)).allowPass).toBe(true);
    expect(optionsFor(presetRules("noFaceOff", 2)).allowPass).toBe(false);
    expect(
      optionsFor({ ...presetRules("classic", 2), scoring: "direct" })
        .stealReward,
    ).toBe(false);
  });
});

describe("face-off styles", () => {
  it("no face-off: teams take turns playing whole boards", () => {
    const c = content({ faceOffMethod: "none" });
    const first = play(c, two, [start()]);
    expect(first.board).toMatchObject({ phase: "control", control: "A" });

    const second = play(c, two, [start(), { type: "closeBoard" }, start("b2")]);
    expect(second.board).toMatchObject({ phase: "control", control: "B" });
  });

  it("no face-off with more teams: every team plays a board in turn", () => {
    const c = contentSchema.parse({
      ...content({ playStyle: "faceOffLadder", faceOffMethod: "none" }),
      boards: ["b1", "b2", "b3", "b4"].map((id) => board(id)),
    });
    const controls: string[] = [];
    let state = initialState(four);
    for (const id of ["b1", "b2", "b3", "b4"]) {
      state = apply(c, state, start(id))._unsafeUnwrap().state;
      controls.push(state.board!.control!);
      expect(state.board!.faceOffTeams[0]).toBe(state.board!.control);
      state = apply(c, state, { type: "closeBoard" })._unsafeUnwrap().state;
    }
    expect(controls).toEqual(["A", "B", "C", "D"]);
  });

  it("no pass: the face-off winner plays", () => {
    const c = content({ allowPass: false });
    const { board: b } = play(c, two, [
      start(),
      {
        type: "faceOff",
        answers: [
          { team: "A", answerId: a(2) },
          { team: "B", answerId: a(3) },
        ],
      },
    ]);
    expect(b).toMatchObject({ phase: "control", control: "A", bank: 70 });
  });

  it("direct scoring: rows score for whoever found them, and a steal is just the row", () => {
    const c = content({ scoring: "direct" });
    const { board: b, totals } = play(c, two, [
      start(),
      {
        type: "faceOff",
        answers: [
          { team: "A", answerId: a(2) },
          { team: "B", answerId: a(3) },
        ],
      },
      { type: "playOrPass", play: true },
      answer(4),
      ...strikes(3),
      { type: "steal", answers: { B: a(1) } },
    ]);
    expect(totals).toEqual({ A: 40 + 20, B: 30 + 50 });
    expect(b).toMatchObject({ phase: "closed", bank: 0, bankWinners: [] });
  });

  it("no steal: striking out ends the board and the playing team keeps the bank", () => {
    const c = content({ stealBy: "none", faceOffMethod: "none" });
    const { board: b, totals } = play(c, two, [
      start(),
      answer(1),
      ...strikes(3),
    ]);
    expect(b.phase).toBe("closed");
    expect(totals).toEqual({ A: 50, B: 0 });
  });

  it("head-to-head: only the face-off opponent may steal", () => {
    const c = content({ playStyle: "faceOffLadder", stealBy: "opponent" });
    const { state } = play(c, four, [
      start(),
      {
        type: "faceOff",
        answers: [
          { team: "A", answerId: a(1) },
          { team: "B", answerId: null },
        ],
      },
      { type: "playOrPass", play: true },
      ...strikes(3),
    ]);
    expect(stealersOf(c.rules, state.board!)).toEqual(["B"]);
    const refused = apply(c, state, {
      type: "steal",
      answers: { C: a(2) },
    });
    expect(refused._unsafeUnwrapErr()).toEqual({
      kind: "unknownTeam",
      team: "C",
    });
  });

  it("every correct stealer can take the bank", () => {
    const c = content({
      playStyle: "faceOffLadder",
      stealWinner: "allCorrect",
      faceOffMethod: "none",
    });
    const { totals } = play(c, four, [
      start(),
      answer(1),
      ...strikes(3),
      { type: "steal", answers: { B: a(2), C: a(5), D: null } },
    ]);
    // Bank 50 to both correct stealers, plus each one's own row.
    expect(totals).toEqual({ A: 0, B: 50 + 40, C: 50 + 10, D: 0 });
  });

  it("a steal can be worth only the row, leaving the bank with the playing team", () => {
    const c = content({ stealReward: "rowOnly", faceOffMethod: "none" });
    const { totals, board: b } = play(c, two, [
      start(),
      answer(1),
      ...strikes(3),
      { type: "steal", answers: { B: a(2) } },
    ]);
    expect(totals).toEqual({ A: 50, B: 40 });
    expect(b.bankWinners).toEqual(["A"]);
  });

  it("a miss penalty comes off the playing team for each strike", () => {
    const c = content({
      missPenalty: 5,
      faceOffMethod: "none",
      stealBy: "none",
    });
    const { totals } = play(c, two, [start(), answer(2), ...strikes(3)]);
    expect(totals).toEqual({ A: 40 - 15, B: 0 });
  });

  it("a practice board never changes scores, even with a penalty", () => {
    const c = content({ missPenalty: 5, faceOffMethod: "none" });
    const { totals } = play(c, two, [start("p"), answer(1, "p"), answer(null)]);
    expect(totals).toEqual({ A: 0, B: 0 });
  });
});

describe("turn styles", () => {
  it("pass-along: a team keeps the turn until it misses", () => {
    const c = content({ playStyle: "passAlong", turnCycles: 1 });
    const { board: b, totals } = play(
      c,
      ["A", "B", "C"],
      [
        start(),
        answer(1),
        answer(2),
        answer(null), // A misses: B's turn
        answer(3),
        answer(null), // C's turn
      ],
    );
    expect(totals).toEqual({ A: 90, B: 30, C: 0 });
    expect(
      projectPublic(c, { ...initialState([]), board: b }, "running").board,
    ).toMatchObject({ currentTeam: "C", keepTurnOnHit: true });
    const after = apply(
      c,
      { ...initialState(["A", "B", "C"]), board: b },
      answer(null),
    );
    expect(after._unsafeUnwrap().state.board!.phase).toBe("closed");
  });

  it("round robin: a miss penalty applies to the team whose turn it was", () => {
    const c = content({ playStyle: "roundRobin", missPenalty: 3 });
    const { totals } = play(c, two, [start(), answer(null), answer(1)]);
    expect(totals).toEqual({ A: -3, B: 50 });
  });
});

describe("buzz race", () => {
  const race = (team: string, n: number | null): Action => ({
    type: "raceAnswer",
    team,
    answerId: n === null ? null : a(n),
  });

  it("a wrong answer sits the team out until the next answer is found", () => {
    const c = content({ playStyle: "buzzRace" });
    const { state } = play(c, four, [start(), race("A", null)]);
    expect(state.board!.lockedOut).toEqual(["A"]);
    expect(apply(c, state, race("A", 1))._unsafeUnwrapErr()).toEqual({
      kind: "teamLockedOut",
      team: "A",
    });

    const { board: b, totals } = play(c, four, [
      start(),
      race("A", null),
      race("B", 2),
    ]);
    expect(totals).toMatchObject({ A: 0, B: 40 });
    expect(b.lockedOut).toEqual([]);
  });

  it("if every team misses the same answer, everyone gets another go", () => {
    const c = content({ playStyle: "buzzRace" });
    const { board: b } = play(c, two, [
      start(),
      race("A", null),
      race("B", null),
    ]);
    expect(b).toMatchObject({ phase: "race", lockedOut: [] });
  });

  it("after-strikes lockout: a team sits out the board after its misses; all out closes it", () => {
    const c = content({
      playStyle: "buzzRace",
      raceLockout: "afterStrikes",
      strikes: 2,
    });
    const { board: b } = play(c, two, [
      start(),
      race("A", null),
      race("A", 1),
      race("A", null),
    ]);
    expect(b.lockedOut).toEqual(["A"]);
    const out = play(c, two, [
      start(),
      race("A", null),
      race("A", null),
      race("B", null),
      race("B", null),
    ]);
    expect(out.board.phase).toBe("closed");
  });

  it("no lockout: a team can try again at once; the board closes when all are found", () => {
    const c = content({ playStyle: "buzzRace", raceLockout: "none" });
    const { board: b, totals } = play(c, two, [
      start(),
      race("A", null),
      race("A", 1),
      race("B", 2),
      race("A", 3),
      race("B", 4),
      race("B", 5),
    ]);
    expect(b.phase).toBe("closed");
    expect(totals).toEqual({ A: 80, B: 70 });
  });
});

describe("all-play shared answers", () => {
  const round = (answers: Record<string, number | null>): Action => ({
    type: "allPlayRound",
    answers: Object.fromEntries(
      Object.entries(answers).map(([t, n]) => [t, n === null ? null : a(n)]),
    ),
  });

  it("split: teams finding the same row share its points", () => {
    const c = content({ playStyle: "allPlay", sharedAnswers: "split" });
    const { totals } = play(
      c,
      ["A", "B", "C"],
      [start(), round({ A: 1, B: 1, C: 3 })],
    );
    expect(totals).toEqual({ A: 25, B: 25, C: 30 });
  });

  it("unique only: a row found by several teams scores for nobody", () => {
    const c = content({ playStyle: "allPlay", sharedAnswers: "uniqueOnly" });
    const { totals, board: b } = play(
      c,
      ["A", "B", "C"],
      [start(), round({ A: 1, B: 1, C: 3 })],
    );
    expect(totals).toEqual({ A: 0, B: 0, C: 30 });
    // The shared row is still shown, so it can't be scored later.
    expect(b.revealed.map((r) => r.rank).sort()).toEqual([1, 3]);
  });
});

describe("target score", () => {
  it("is part of the public view", () => {
    const c = content({ targetScore: 300 });
    const { state } = play(c, two, [start()]);
    expect(projectPublic(c, state, "running").targetScore).toBe(300);
  });
});

describe("open answering", () => {
  const credit = (n: number, teams: string[]): Action => ({
    type: "credit",
    answerId: a(n),
    teams,
  });

  it("any team, any order: every team that got a row scores it", () => {
    const c = content({ playStyle: "open" });
    const { totals, board: b } = play(
      c,
      ["A", "B", "C"],
      [start(), credit(3, ["C"]), credit(1, ["A", "B"]), credit(5, [])],
    );
    expect(totals).toEqual({ A: 50, B: 50, C: 30 });
    expect(b.phase).toBe("open");
    expect(b.revealed.find((r) => r.rank === 5)).toMatchObject({
      teams: [],
      points: 0,
    });
  });

  it("refuses an answer already on the board, and closes when all are found", () => {
    const c = content({ playStyle: "open" });
    const { state } = play(c, two, [start(), credit(1, ["A"])]);
    expect(apply(c, state, credit(1, ["B"]))._unsafeUnwrapErr()).toEqual({
      kind: "answerShown",
    });
    const all = play(c, two, [
      start(),
      ...[1, 2, 3, 4, 5].map((n) => credit(n, ["A"])),
    ]);
    expect(all.board.phase).toBe("closed");
  });

  it("split and unique-only sharing, and a miss penalty", () => {
    const split = play(
      content({ playStyle: "open", sharedAnswers: "split" }),
      two,
      [start(), credit(1, ["A", "B"])],
    );
    expect(split.totals).toEqual({ A: 25, B: 25 });
    const unique = play(
      content({ playStyle: "open", sharedAnswers: "uniqueOnly" }),
      two,
      [start(), credit(1, ["A", "B"]), credit(2, ["B"])],
    );
    expect(unique.totals).toEqual({ A: 0, B: 40 });
    const penalty = play(content({ playStyle: "open", missPenalty: 4 }), two, [
      start(),
      { type: "miss", team: "A" },
    ]);
    expect(penalty.totals).toEqual({ A: -4, B: 0 });
  });

  it("is suggested for three or more teams", () => {
    expect(presetRules("open", 5).playStyle).toBe("open");
    expect(resolveRules(presetRules("open", 5)).sharedAnswers).toBe("full");
  });
});
