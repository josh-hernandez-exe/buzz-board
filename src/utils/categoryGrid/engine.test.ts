import { describe, expect, it } from "vitest";

import {
  allCellKeys,
  bankSchema,
  emptyBank,
  gridPreflight,
  type Bank,
  type GridRules,
} from "./content";
import {
  applyGrid,
  gridPhase,
  initialGridState,
  undoGrid,
  type GridAction,
  type GridState,
} from "./engine";
import { projectGrid } from "./projection";
import { sampleBank } from "./sample";

function bank(rules?: GridRules): Bank {
  const b = sampleBank();
  return bankSchema.parse({
    ...b,
    modes: {
      categoryGrid: { ...b.modes.categoryGrid, ...(rules ? { rules } : {}) },
    },
  });
}

function play(b: Bank, teams: string[], actions: GridAction[]) {
  let state: GridState = initialGridState(teams);
  const totals: Record<string, number> = Object.fromEntries(
    teams.map((t) => [t, 0]),
  );
  for (const action of actions) {
    const step = applyGrid(b, state, action)._unsafeUnwrap();
    state = step.state;
    for (const [t, p] of Object.entries(step.scores)) totals[t]! += p;
  }
  return { state, totals };
}

const open = (cell: string): GridAction => ({ type: "openClue", cell });
const judge = (team: string, correct: boolean): GridAction => ({
  type: "judge",
  team,
  correct,
});
const close: GridAction = { type: "closeClue" };

describe("content", () => {
  it("the sample is a complete 5×5 grid", () => {
    const b = sampleBank();
    expect(gridPreflight(b, 3)).toEqual({ blocking: [], warnings: [] });
    expect(allCellKeys(b)).toHaveLength(25);
  });

  it("preflight blocks empty clues, missing questions and ragged grids", () => {
    const b = emptyBank(2, 2);
    const problems = gridPreflight(b, 2).blocking.join("\n");
    expect(problems).toMatch(/Category 1 needs a title/);
    expect(problems).toMatch(/the clue is empty/);
    const ragged = structuredClone(sampleBank());
    ragged.modes.categoryGrid!.columns[0]!.cells.pop();
    expect(gridPreflight(ragged, 2).blocking).toContain(
      "Every category needs the same number of clues.",
    );
    const missing = structuredClone(sampleBank());
    missing.modes.categoryGrid!.columns[0]!.cells[0]!.questionId = "nope";
    expect(gridPreflight(missing, 2).blocking.join()).toMatch(
      /question "nope" doesn't exist/,
    );
  });

  it("accepts media, refuses unknown fields, and blocks unsafe media at start", () => {
    const b = structuredClone(sampleBank());
    b.questions[0]!.prompt.media = [
      { type: "image", url: "https://x.example/tree.png", alt: "A tree" },
    ];
    expect(bankSchema.safeParse(b).success).toBe(true);
    const odd = structuredClone(b) as unknown as {
      questions: { prompt: Record<string, unknown> }[];
    };
    odd.questions[0]!.prompt.html = "<b>";
    expect(bankSchema.safeParse(odd).success).toBe(false);
    b.questions[1]!.prompt.media = [
      { type: "image", url: "javascript:alert(1)", alt: "x" },
    ];
    expect(gridPreflight(b, 2).blocking.join()).toMatch(/isn't a safe link/);
  });

  it("only sends a clue's media while it's open, and the answer's once shown", () => {
    const b = structuredClone(sampleBank());
    const q = b.questions.find((x) => x.id === "cat1-1")!;
    q.prompt.media = [
      { type: "image", url: "https://x.example/flake.png", alt: "A snowflake" },
      { type: "image", url: "javascript:alert(1)", alt: "bad" },
    ];
    q.answer.media = [
      { type: "image", url: "https://x.example/six.png", alt: "Six sides" },
    ];
    const s0 = initialGridState(["A", "B"]);
    expect(JSON.stringify(projectGrid(b, s0, "running"))).not.toContain(
      "flake.png",
    );
    const s1 = applyGrid(b, s0, open("cat1:0"))._unsafeUnwrap().state;
    const clue = projectGrid(b, s1, "running").clue!;
    expect(clue.promptMedia.map((m) => m.url)).toEqual([
      "https://x.example/flake.png",
    ]);
    expect(clue.answerMedia).toEqual([]);
    expect(JSON.stringify(clue)).not.toContain("six.png");
    const s2 = applyGrid(b, s1, { type: "revealAnswer" })._unsafeUnwrap().state;
    expect(projectGrid(b, s2, "running").clue!.answerMedia).toHaveLength(1);
  });
});

describe("play", () => {
  it("a right answer scores the clue and gives that team the next pick", () => {
    const b = bank();
    const { state, totals } = play(
      b,
      ["A", "B"],
      [open("cat1:2"), judge("B", true)],
    );
    expect(totals).toEqual({ A: 0, B: 300 });
    expect(state.selector).toBe("B");
    expect(gridPhase(state)).toBe("answered");
    const after = play(
      b,
      ["A", "B"],
      [open("cat1:2"), judge("B", true), close],
    );
    expect(after.state.used["cat1:2"]).toEqual({
      result: "correct",
      team: "B",
    });
    expect(gridPhase(after.state)).toBe("board");
  });

  it("a wrong answer locks the team out of that clue by default, with no penalty", () => {
    const b = bank();
    const { state, totals } = play(
      b,
      ["A", "B"],
      [open("cat2:0"), judge("A", false)],
    );
    expect(totals).toEqual({ A: 0, B: 0 });
    expect(applyGrid(b, state, judge("A", true))._unsafeUnwrapErr()).toEqual({
      kind: "teamLockedOut",
      team: "A",
    });
    // A fresh clue: A can answer again.
    const next = play(
      b,
      ["A", "B"],
      [
        open("cat2:0"),
        judge("A", false),
        { type: "revealAnswer" },
        close,
        open("cat2:1"),
        judge("A", true),
      ],
    );
    expect(next.totals.A).toBe(200);
    // Nobody got cat2:0, so the pick stayed with A (the first selector).
    expect(next.state.used["cat2:0"]).toEqual({
      result: "unanswered",
      team: null,
    });
  });

  it("clue-value penalty and no lockout, when the rules say so", () => {
    const b = bank({
      wrongAnswerPenalty: "clueValue",
      wrongAnswerLockout: false,
    });
    const { totals } = play(
      b,
      ["A", "B"],
      [open("cat3:3"), judge("A", false), judge("A", true)],
    );
    expect(totals).toEqual({ A: -400 + 400, B: 0 });
  });

  it("void takes back exactly this clue's points and gives the pick back", () => {
    const b = bank({ wrongAnswerPenalty: "clueValue" });
    const { state, totals } = play(
      b,
      ["A", "B", "C"],
      [
        open("cat1:0"),
        judge("C", true),
        close,
        open("cat4:4"),
        judge("A", false),
        judge("B", true),
        { type: "voidClue" },
      ],
    );
    expect(totals).toEqual({ A: 0, B: 0, C: 100 });
    expect(state.selector).toBe("C");
    expect(state.used["cat4:4"]).toEqual({ result: "void", team: null });
    expect(applyGrid(b, state, open("cat4:4"))._unsafeUnwrapErr()).toEqual({
      kind: "cellUsed",
    });
  });

  it("refuses actions out of turn", () => {
    const b = bank();
    const s = initialGridState(["A", "B"]);
    expect(applyGrid(b, s, judge("A", true))._unsafeUnwrapErr().kind).toBe(
      "gridWrongPhase",
    );
    expect(applyGrid(b, s, open("nope:0"))._unsafeUnwrapErr().kind).toBe(
      "unknownCell",
    );
    const opened = applyGrid(b, s, open("cat1:0"))._unsafeUnwrap().state;
    expect(applyGrid(b, opened, open("cat1:1"))._unsafeUnwrapErr().kind).toBe(
      "gridWrongPhase",
    );
    expect(
      applyGrid(b, opened, { type: "finish" })._unsafeUnwrapErr().kind,
    ).toBe("gridWrongPhase");
    expect(applyGrid(b, opened, judge("Z", true))._unsafeUnwrapErr().kind).toBe(
      "unknownTeam",
    );
  });
});

describe("undo never hides what people saw", () => {
  it("undoing an opened clue leaves the tile used up (void)", () => {
    const b = bank();
    const s0 = initialGridState(["A", "B"]);
    const s1 = applyGrid(b, s0, open("cat1:0"))._unsafeUnwrap().state;
    const back = undoGrid(s1, s0);
    expect(gridPhase(back)).toBe("board");
    expect(back.used["cat1:0"]).toEqual({ result: "void", team: null });
    expect(applyGrid(b, back, open("cat1:0"))._unsafeUnwrapErr().kind).toBe(
      "cellUsed",
    );
  });

  it("undoing a judgement keeps a shown answer shown, so the host can re-judge", () => {
    const b = bank();
    const s0 = initialGridState(["A", "B"]);
    const s1 = applyGrid(b, s0, open("cat1:0"))._unsafeUnwrap().state;
    const s2 = applyGrid(b, s1, judge("A", true))._unsafeUnwrap().state;
    const back = undoGrid(s2, s1);
    expect(back.clue).toMatchObject({ phase: "open", answerShown: true });
    expect(projectGrid(b, back, "running").clue?.answer).toBe("Six");
    const fixed = applyGrid(b, back, judge("B", true))._unsafeUnwrap();
    expect(fixed.scores).toEqual({ B: 100 });
  });
});

describe("what players see", () => {
  it("tiles never carry clue text; answers only once shown", () => {
    const b = bank();
    const s0 = initialGridState(["A", "B"]);
    const board = projectGrid(b, s0, "running");
    const json = JSON.stringify(board);
    for (const q of b.questions) {
      expect(json).not.toContain(q.prompt.text);
      expect(json).not.toContain(q.answer.text);
    }
    const s1 = applyGrid(b, s0, open("cat1:0"))._unsafeUnwrap().state;
    const clue = projectGrid(b, s1, "running").clue!;
    expect(clue.prompt).toBe("How many sides does a typical snowflake have?");
    expect(clue.answer).toBeNull();
    expect(JSON.stringify(projectGrid(b, s1, "running"))).not.toContain("Six");
  });
});

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  };
}

describe("randomised grids keep every invariant", () => {
  it("over many seeds and rule combinations", { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const rules: GridRules = {
        wrongAnswerLockout: r.chance(0.7),
        wrongAnswerPenalty: r.chance(0.4) ? "clueValue" : "none",
      };
      const b = bank(rules);
      const teams = ["A", "B", "C", "D"].slice(0, 2 + Math.floor(seed % 3));
      const keys = allCellKeys(b);
      let state = initialGridState(teams);
      const history: { state: GridState; scores: Record<string, number> }[] =
        [];
      const totals: Record<string, number> = Object.fromEntries(
        teams.map((t) => [t, 0]),
      );
      const everShown = new Set<string>();
      const answerSeen = new Set<string>();
      for (let i = 0; i < 200 && !state.finished; i++) {
        const label = `seed ${seed} step ${i}`;
        if (history.length > 0 && r.chance(0.1)) {
          const last = history.pop()!;
          state = undoGrid(state, last.state);
          for (const [t, p] of Object.entries(last.scores)) totals[t]! -= p;
        } else {
          const action: GridAction = r.pick<GridAction>([
            open(r.pick(keys)),
            judge(r.pick(teams), r.chance(0.4)),
            { type: "revealAnswer" },
            close,
            ...(r.chance(0.1) ? [{ type: "voidClue" } as const] : []),
            { type: "setSelector", team: r.pick(teams) },
            ...(r.chance(0.02) ? [{ type: "finish" } as const] : []),
          ]);
          const result = applyGrid(b, state, action);
          if (result.isErr()) continue;
          history.push({ state, scores: result.value.scores });
          state = result.value.state;
          for (const [t, p] of Object.entries(result.value.scores)) {
            totals[t]! += p;
          }
          // Points only ever come from a judgement or a void.
          if (Object.keys(result.value.scores).length > 0) {
            expect(["judge", "voidClue"], label).toContain(action.type);
          }
          if (rules.wrongAnswerPenalty === "none") {
            if (action.type === "judge") {
              for (const p of Object.values(result.value.scores)) {
                expect(p > 0, label).toBe(true);
              }
            }
          }
        }
        // Seen clues stay used up; seen answers stay seen.
        if (state.clue) {
          everShown.add(state.clue.cell);
          if (state.clue.answerShown) answerSeen.add(state.clue.cell);
        }
        for (const cell of everShown) {
          expect(
            state.used[cell] !== undefined || state.clue?.cell === cell,
            `${label}: seen clue ${cell} can be opened again`,
          ).toBe(true);
        }
        if (state.clue && answerSeen.has(state.clue.cell)) {
          expect(state.clue.answerShown, `${label}: answer hidden again`).toBe(
            true,
          );
        }
        // A clue's net points are what its attempts say.
        if (state.clue) {
          const winners = state.clue.attempts.filter((a) => a.correct);
          expect(winners.length <= 1, label).toBe(true);
        }
        // Players never get an answer that wasn't shown.
        const view = projectGrid(b, state, "running");
        if (view.clue && !state.clue?.answerShown) {
          expect(view.clue.answer, label).toBeNull();
        }
      }
      // The scoreboard total equals replaying what's left in history.
      const replay: Record<string, number> = Object.fromEntries(
        teams.map((t) => [t, 0]),
      );
      for (const h of history) {
        for (const [t, p] of Object.entries(h.scores)) replay[t]! += p;
      }
      expect(replay, `seed ${seed}`).toEqual(totals);
    }
  });
});
