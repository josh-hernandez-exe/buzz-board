/**
 * The Sequential Quiz engine (pub-quiz rounds, W16): questions in a fixed
 * order; teams type answers while a question is open; the host locks,
 * grades (grouping identical answers), resolves teams that didn't answer,
 * then reveals and awards points once. Pure and deterministic.
 *
 * Teams' typed answers live in their own table (TeamAnswer), not here, so
 * teams never wait for each other; this state holds the host's side.
 */
import { err, ok, type Result } from "neverthrow";

import type { Bank } from "@/utils/categoryGrid/content";

export type Verdict = "correct" | "incorrect" | "missing";

export type QuizResult = {
  key: string;
  questionId: string;
  correct: string[];
  points: number;
  voided: boolean;
};

export type QuizPhase = "ready" | "open" | "locked" | "revealed" | "finished";

export type QuizState = {
  teams: string[];
  /** Position in the quiz order of the current question; -1 before the first. */
  position: number;
  phase: QuizPhase;
  /** The host's verdicts for the current question. */
  grades: Record<string, Verdict>;
  /** Stays true once the answer was on screens, even across undo. */
  answerShown: boolean;
  /** Voided: closed with no points and no answer shown. */
  voided: boolean;
  results: QuizResult[];
};

export type QuizAction =
  | { type: "next" }
  | { type: "lock" }
  | { type: "reopen" }
  /**
   * Grade one or more teams. `from` is what the host's screen showed for
   * each, so two hosts grading the same answer can't silently overwrite;
   * `key` is the question the screen showed, so a mark from a screen that
   * hasn't caught up never lands on the next question.
   */
  | {
      type: "grade";
      key: string;
      teams: string[];
      verdict: "correct" | "incorrect";
      from: Record<string, Verdict | null>;
    }
  /**
   * Every team without a verdict: incorrect if it answered, missing if not.
   * `answered` is filled in by the server from the stored answers.
   */
  | { type: "resolveRemaining"; answered?: string[] }
  | { type: "reveal" }
  | { type: "void" }
  | { type: "finish" };

export type QuizError =
  | { kind: "quizWrongPhase"; phase: QuizPhase }
  | { kind: "noMoreQuestions" }
  | { kind: "unknownTeam"; team: string }
  | { kind: "gradeConflict"; team: string }
  | { kind: "staleQuestion" }
  | { kind: "ungraded"; teams: string[] };

export const quizOrder = (bank: Bank) =>
  bank.modes.pubQuiz?.questionOrder ?? [];
export const quizPoints = (bank: Bank) =>
  bank.modes.pubQuiz?.pointsPerQuestion ?? 1;

/** The question as played: "<position>:<questionId>". */
export function questionKey(bank: Bank, state: QuizState): string | null {
  const id = quizOrder(bank)[state.position];
  return state.position >= 0 && id ? `${state.position}:${id}` : null;
}

export function initialQuizState(teams: string[]): QuizState {
  return {
    teams,
    position: -1,
    phase: "ready",
    grades: {},
    answerShown: false,
    voided: false,
    results: [],
  };
}

export function applyQuiz(
  bank: Bank,
  state: QuizState,
  action: QuizAction,
): Result<{ state: QuizState; scores: Record<string, number> }, QuizError> {
  const phase = state.phase;
  const wrong = () => err({ kind: "quizWrongPhase" as const, phase });
  const done = (next: QuizState, scores: Record<string, number> = {}) =>
    ok({ state: next, scores });
  const record = (correct: string[], points: number, voided: boolean) => [
    ...state.results,
    {
      key: questionKey(bank, state)!,
      questionId: quizOrder(bank)[state.position]!,
      correct,
      points,
      voided,
    },
  ];

  switch (action.type) {
    case "next": {
      if (phase !== "ready" && phase !== "revealed") return wrong();
      if (state.position + 1 >= quizOrder(bank).length) {
        return err({ kind: "noMoreQuestions" });
      }
      return done({
        ...state,
        position: state.position + 1,
        phase: "open",
        grades: {},
        answerShown: false,
        voided: false,
      });
    }
    case "lock":
      return phase === "open" ? done({ ...state, phase: "locked" }) : wrong();
    case "reopen":
      // Once the answer was shown, answering can't start again.
      return phase === "locked" && !state.answerShown
        ? done({ ...state, phase: "open" })
        : wrong();
    case "grade": {
      if (phase !== "locked") return wrong();
      if (action.key !== questionKey(bank, state)) {
        return err({ kind: "staleQuestion" });
      }
      const bad = action.teams.find((t) => !state.teams.includes(t));
      if (bad) return err({ kind: "unknownTeam", team: bad });
      for (const t of action.teams) {
        if ((state.grades[t] ?? null) !== (action.from[t] ?? null)) {
          return err({ kind: "gradeConflict", team: t });
        }
      }
      const grades = { ...state.grades };
      for (const t of action.teams) grades[t] = action.verdict;
      return done({ ...state, grades });
    }
    case "resolveRemaining": {
      if (phase !== "locked") return wrong();
      const answered = new Set(action.answered ?? []);
      const grades = { ...state.grades };
      for (const t of state.teams) {
        grades[t] ??= answered.has(t) ? "incorrect" : "missing";
      }
      return done({ ...state, grades });
    }
    case "reveal": {
      if (phase !== "locked") return wrong();
      const ungraded = state.teams.filter((t) => !state.grades[t]);
      if (ungraded.length > 0)
        return err({ kind: "ungraded", teams: ungraded });
      const points = quizPoints(bank);
      const correct = state.teams.filter((t) => state.grades[t] === "correct");
      return done(
        {
          ...state,
          phase: "revealed",
          answerShown: true,
          results: record(correct, points, false),
        },
        Object.fromEntries(correct.map((t) => [t, points])),
      );
    }
    case "void": {
      if (phase !== "open" && phase !== "locked") return wrong();
      return done({
        ...state,
        phase: "revealed",
        voided: true,
        results: record([], 0, true),
      });
    }
    case "finish":
      return phase === "ready" || phase === "revealed"
        ? done({ ...state, phase: "finished" })
        : wrong();
  }
}

/**
 * Undo that never hides an answer people have seen: undoing a reveal goes
 * back to grading with the answer still showing, so the host corrects the
 * grades and reveals again (points are taken back and re-awarded).
 */
export function undoQuiz(current: QuizState, previous: QuizState): QuizState {
  const restored: QuizState = structuredClone(previous);
  if (
    current.answerShown &&
    current.position === restored.position &&
    !restored.answerShown
  ) {
    restored.answerShown = true;
  }
  // Answering never reopens once people have seen the answer: undoing past
  // the lock stays locked.
  if (restored.answerShown && restored.phase === "open") {
    restored.phase = "locked";
  }
  return restored;
}
