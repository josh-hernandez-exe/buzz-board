import { describe, expect, it } from "vitest";

import { bankSchema, type Bank } from "@/utils/categoryGrid/content";

import { emptyQuizBank, normalizeAnswer, quizPreflight } from "./content";
import {
  applyQuiz,
  initialQuizState,
  questionKey,
  undoQuiz,
  type QuizAction,
  type QuizState,
} from "./engine";
import { projectQuiz } from "./projection";
import { sampleQuizBank } from "./sample";

const TEAMS = ["a", "b", "c"];

function quiz(points = 10): Bank {
  const b = sampleQuizBank();
  return bankSchema.parse({
    ...b,
    modes: { pubQuiz: { ...b.modes.pubQuiz!, pointsPerQuestion: points } },
  });
}

function run(b: Bank, state: QuizState, action: QuizAction) {
  return applyQuiz(b, state, action)._unsafeUnwrap();
}

function play(b: Bank, actions: QuizAction[], teams = TEAMS) {
  let state = initialQuizState(teams);
  const totals: Record<string, number> = {};
  for (const action of actions) {
    const step = run(b, state, action);
    state = step.state;
    for (const [t, p] of Object.entries(step.scores)) {
      totals[t] = (totals[t] ?? 0) + p;
    }
  }
  return { state, totals };
}

/** The key of the first question, where most of these tests mark. */
const FIRST = `0:${sampleQuizBank().modes.pubQuiz!.questionOrder[0]}`;

const grade = (
  teams: string[],
  verdict: "correct" | "incorrect",
  from: Record<string, null> = Object.fromEntries(teams.map((t) => [t, null])),
  key = FIRST,
): QuizAction => ({ type: "grade", key, teams, verdict, from });

describe("Sequential Quiz content", () => {
  it("ships a sample quiz that is ready to start", () => {
    const b = sampleQuizBank();
    expect(bankSchema.safeParse(b).success).toBe(true);
    expect(b.modes.pubQuiz!.questionOrder.length).toBeGreaterThanOrEqual(10);
    expect(b.modes.categoryGrid).toBeUndefined();
    expect(quizPreflight(b, 3)).toEqual({ blocking: [], warnings: [] });
  });

  it("blocks an empty quiz, missing questions and blank questions", () => {
    expect(quizPreflight(emptyQuizBank(), 2).blocking).toContain(
      "Add at least one question to the quiz.",
    );
    expect(quizPreflight(sampleQuizBank(), 0).blocking).toContain(
      "Add at least one team or player.",
    );
    const b = sampleQuizBank();
    const broken: Bank = {
      ...b,
      questions: b.questions.map((q, i) =>
        i === 0 ? { ...q, answer: { text: "" } } : q,
      ),
      modes: {
        pubQuiz: {
          ...b.modes.pubQuiz!,
          questionOrder: [...b.modes.pubQuiz!.questionOrder, "nope"],
        },
      },
    };
    const { blocking } = quizPreflight(broken, 2);
    expect(blocking.some((p) => p.startsWith("Question 1:"))).toBe(true);
    expect(blocking.some((p) => p.includes('"nope" doesn\'t exist'))).toBe(
      true,
    );
  });

  it("warns about repeats and questions left out", () => {
    const b = sampleQuizBank();
    const order = b.modes.pubQuiz!.questionOrder;
    const { warnings, blocking } = quizPreflight(
      {
        ...b,
        modes: {
          pubQuiz: {
            ...b.modes.pubQuiz!,
            questionOrder: [order[0]!, order[0]!],
          },
        },
      },
      2,
    );
    expect(blocking).toEqual([]);
    expect(warnings.join(" ")).toMatch(/more than once/);
    expect(warnings.join(" ")).toMatch(/aren't in the quiz/);
  });

  it("groups answers ignoring case, accents, spaces and punctuation", () => {
    expect(normalizeAnswer("  The Winter-Solstice! ")).toBe(
      "the winter solstice",
    );
    expect(normalizeAnswer("Noël")).toBe(normalizeAnswer("noel"));
    expect(normalizeAnswer("...")).toBe("");
  });
});

describe("Sequential Quiz engine", () => {
  it("plays a question: open, lock, mark, reveal, points once", () => {
    const b = quiz(10);
    const { state, totals } = play(b, [
      { type: "next" },
      { type: "lock" },
      grade(["a", "b"], "correct"),
      { type: "resolveRemaining", answered: ["c"] },
      { type: "reveal" },
    ]);
    expect(totals).toEqual({ a: 10, b: 10 });
    expect(state.phase).toBe("revealed");
    expect(state.grades).toEqual({
      a: "correct",
      b: "correct",
      c: "incorrect",
    });
    expect(state.results).toEqual([
      {
        key: questionKey(b, { ...state }),
        questionId: b.modes.pubQuiz!.questionOrder[0],
        correct: ["a", "b"],
        points: 10,
        voided: false,
      },
    ]);
  });

  it("marks teams that didn't answer as missing", () => {
    const { state } = play(quiz(), [
      { type: "next" },
      { type: "lock" },
      { type: "resolveRemaining", answered: ["a"] },
    ]);
    expect(state.grades).toEqual({
      a: "incorrect",
      b: "missing",
      c: "missing",
    });
  });

  it("won't reveal until every team is marked", () => {
    const b = quiz();
    const { state } = play(b, [
      { type: "next" },
      { type: "lock" },
      grade(["a"], "correct"),
    ]);
    expect(applyQuiz(b, state, { type: "reveal" })._unsafeUnwrapErr()).toEqual({
      kind: "ungraded",
      teams: ["b", "c"],
    });
  });

  it("only marks while answers are locked", () => {
    const b = quiz();
    const { state } = play(b, [{ type: "next" }]);
    expect(
      applyQuiz(b, state, grade(["a"], "correct"))._unsafeUnwrapErr(),
    ).toEqual({
      kind: "quizWrongPhase",
      phase: "open",
    });
  });

  it("refuses a mark made from an out-of-date screen", () => {
    const b = quiz();
    const { state } = play(b, [
      { type: "next" },
      { type: "lock" },
      grade(["a"], "correct"),
    ]);
    // A second host still saw "a" unmarked.
    expect(
      applyQuiz(b, state, grade(["a"], "incorrect"))._unsafeUnwrapErr(),
    ).toEqual({ kind: "gradeConflict", team: "a" });
    // With the current verdict it goes through.
    const changed = run(b, state, {
      type: "grade",
      key: FIRST,
      teams: ["a"],
      verdict: "incorrect",
      from: { a: "correct" },
    });
    expect(changed.state.grades.a).toBe("incorrect");
    expect(
      applyQuiz(b, state, grade(["zz"], "correct"))._unsafeUnwrapErr(),
    ).toEqual({ kind: "unknownTeam", team: "zz" });
  });

  it("refuses a mark meant for another question", () => {
    const b = quiz();
    const { state } = play(b, [
      { type: "next" },
      { type: "lock" },
      { type: "void" },
      { type: "next" },
      { type: "lock" },
    ]);
    // A screen still showing question 1, where "a" was unmarked too.
    expect(
      applyQuiz(b, state, grade(["a"], "correct"))._unsafeUnwrapErr(),
    ).toEqual({ kind: "staleQuestion" });
    const second = questionKey(b, state)!;
    expect(
      run(b, state, grade(["a"], "correct", { a: null }, second)).state.grades,
    ).toEqual({ a: "correct" });
  });

  it("undo never reopens answering once the answer was shown", () => {
    const b = quiz();
    const steps: QuizAction[] = [
      { type: "next" },
      { type: "lock" },
      grade(["a", "b", "c"], "correct"),
      { type: "reveal" },
    ];
    const states = [initialQuizState(TEAMS)];
    for (const a of steps) states.push(run(b, states.at(-1)!, a).state);
    // Undo the reveal, the marks and the lock, in turn.
    let current = states.at(-1)!;
    for (let i = states.length - 2; i >= 1; i--) {
      current = undoQuiz(current, states[i]!);
      expect(current.answerShown).toBe(true);
      expect(current.phase).not.toBe("open");
    }
    expect(projectQuiz(b, current, "running").question?.answer).not.toBeNull();
  });

  it("reopens answers until the answer has been shown", () => {
    const b = quiz();
    const { state } = play(b, [{ type: "next" }, { type: "lock" }]);
    expect(run(b, state, { type: "reopen" }).state.phase).toBe("open");
    const shown: QuizState = { ...state, answerShown: true };
    expect(applyQuiz(b, shown, { type: "reopen" }).isErr()).toBe(true);
  });

  it("voids a question: no points, no answer shown", () => {
    const b = quiz();
    const { state, totals } = play(b, [
      { type: "next" },
      { type: "lock" },
      grade(["a"], "correct"),
      { type: "void" },
    ]);
    expect(totals).toEqual({});
    expect(state.voided).toBe(true);
    const view = projectQuiz(b, state, "running");
    expect(view.question?.answer).toBeNull();
    expect(view.correct).toEqual([]);
    // The next question starts fresh.
    const next = run(b, state, { type: "next" }).state;
    expect(next).toMatchObject({ voided: false, grades: {}, phase: "open" });
  });

  it("stops at the last question and finishes only between questions", () => {
    const b = quiz();
    const order = b.modes.pubQuiz!.questionOrder;
    const actions: QuizAction[] = [];
    for (const _id of order) {
      actions.push({ type: "next" }, { type: "lock" }, { type: "void" });
    }
    const { state } = play(b, actions);
    expect(applyQuiz(b, state, { type: "next" })._unsafeUnwrapErr()).toEqual({
      kind: "noMoreQuestions",
    });
    const open = run(b, initialQuizState(TEAMS), { type: "next" }).state;
    expect(applyQuiz(b, open, { type: "finish" }).isErr()).toBe(true);
    expect(run(b, state, { type: "finish" }).state.phase).toBe("finished");
  });

  it("keys a repeated question separately", () => {
    const b = sampleQuizBank();
    const id = b.questions[0]!.id;
    const twice: Bank = {
      ...b,
      modes: { pubQuiz: { questionOrder: [id, id], pointsPerQuestion: 1 } },
    };
    const first = run(twice, initialQuizState(TEAMS), { type: "next" }).state;
    const second = run(
      twice,
      run(twice, run(twice, first, { type: "lock" }).state, { type: "void" })
        .state,
      { type: "next" },
    ).state;
    expect(questionKey(twice, first)).toBe(`0:${id}`);
    expect(questionKey(twice, second)).toBe(`1:${id}`);
  });

  it("undoing a reveal keeps the answer on screen", () => {
    const b = quiz();
    const { state: locked } = play(b, [
      { type: "next" },
      { type: "lock" },
      grade(["a", "b", "c"], "incorrect"),
    ]);
    const revealed = run(b, locked, { type: "reveal" }).state;
    const undone = undoQuiz(revealed, locked);
    expect(undone.phase).toBe("locked");
    expect(undone.answerShown).toBe(true);
    expect(projectQuiz(b, undone, "running").question?.answer).not.toBeNull();
    // ...and answering can't reopen.
    expect(applyQuiz(b, undone, { type: "reopen" }).isErr()).toBe(true);
  });
});

describe("Sequential Quiz projection", () => {
  it("shows nothing secret before the reveal", () => {
    const b = quiz();
    const { state } = play(b, [{ type: "next" }]);
    const view = projectQuiz(
      b,
      state,
      "running",
      { teams: ["a", "gone"], version: 3 },
      7,
    );
    expect(view.question?.answer).toBeNull();
    expect(view.question?.answerMedia).toEqual([]);
    expect(view.answered).toEqual(["a"]);
    expect(view).toMatchObject({ answerVersion: 3, step: 7, number: 1 });
    expect(JSON.stringify(view)).not.toContain(b.questions[0]!.answer.text);
    expect(JSON.stringify(view)).not.toContain("hostNotes");
  });

  it("shows no question before the first or after the end", () => {
    const b = quiz();
    expect(
      projectQuiz(b, initialQuizState(TEAMS), "running").question,
    ).toBeNull();
    const finished: QuizState = {
      ...initialQuizState(TEAMS),
      phase: "finished",
      position: 0,
    };
    expect(projectQuiz(b, finished, "running")).toMatchObject({
      question: null,
      finished: true,
    });
  });
});

/** A small deterministic random number generator for repeatable runs. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("Sequential Quiz invariants under random play and undo", () => {
  it("never double-awards, never un-shows an answer, scores match results", () => {
    const b = quiz(5);
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed);
      const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
      let state = initialQuizState(TEAMS);
      const history: { state: QuizState; scores: Record<string, number> }[] =
        [];
      const totals: Record<string, number> = {};
      const add = (scores: Record<string, number>, sign: 1 | -1) => {
        for (const [t, p] of Object.entries(scores)) {
          totals[t] = (totals[t] ?? 0) + sign * p;
        }
      };
      for (let i = 0; i < 120; i++) {
        if (history.length > 0 && rand() < 0.2) {
          const last = history.pop()!;
          const before = state;
          state = undoQuiz(state, last.state);
          add(last.scores, -1);
          if (before.answerShown && before.position === state.position) {
            expect(state.answerShown).toBe(true);
          }
          if (state.phase === "open") expect(state.answerShown).toBe(false);
          continue;
        }
        const team = pick(TEAMS);
        const action = pick<QuizAction>([
          { type: "next" },
          { type: "lock" },
          { type: "reopen" },
          {
            type: "grade",
            key: questionKey(b, state) ?? "",
            teams: [team],
            verdict: rand() < 0.5 ? "correct" : "incorrect",
            from: { [team]: state.grades[team] ?? null },
          },
          {
            type: "resolveRemaining",
            answered: TEAMS.filter(() => rand() < 0.5),
          },
          { type: "reveal" },
          { type: "void" },
          { type: "finish" },
        ]);
        const result = applyQuiz(b, state, action);
        if (result.isErr()) continue;
        history.push({ state, scores: result.value.scores });
        const before = state;
        state = result.value.state;
        add(result.value.scores, 1);

        if (before.answerShown && before.position === state.position) {
          expect(state.answerShown).toBe(true);
        }
        if (state.phase === "open") expect(state.answerShown).toBe(false);
        // Points on the scoreboard always equal the points in the results.
        const expected: Record<string, number> = {};
        for (const r of state.results) {
          for (const t of r.correct) {
            expected[t] = (expected[t] ?? 0) + r.points;
          }
        }
        for (const t of TEAMS) {
          expect(totals[t] ?? 0).toBe(expected[t] ?? 0);
        }
        // One result per question asked and closed, in order.
        expect(state.results.length).toBeLessThanOrEqual(state.position + 1);
        expect(new Set(state.results.map((r) => r.key)).size).toBe(
          state.results.length,
        );
      }
    }
  });
});
