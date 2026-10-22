/**
 * What players and the audience see of a Sequential Quiz: the open
 * question (text and media), which teams have answered (never what they
 * typed), and after the reveal the answer and who got it. Team answers
 * reach only their own team and the hosts, through separate queries.
 */
import type { Bank } from "@/utils/categoryGrid/content";
import { safeMediaList, type Media } from "@/utils/media";

import {
  questionKey,
  quizOrder,
  quizPoints,
  type QuizPhase,
  type QuizState,
} from "./engine";

/** Which teams have answered the current question, and a counter that moves on every save. */
export type AnswerProgress = { teams: string[]; version: number };

export type PublicQuizView = {
  kind: "sequentialQuiz";
  status: "running" | "ended";
  title: string;
  phase: QuizPhase;
  /** 1-based number of the current question, 0 before the first. */
  number: number;
  total: number;
  points: number;
  question: {
    key: string;
    prompt: string;
    promptMedia: Media[];
    /** null until revealed. */
    answer: string | null;
    answerMedia: Media[];
  } | null;
  /** Teams that have saved an answer to the current question. */
  answered: string[];
  /**
   * Changes whenever any team saves or replaces an answer, so screens know
   * to refresh their own team's answer. Carries no answer content.
   */
  answerVersion: number;
  /** The host's action counter: moves on every host action, marking included. */
  step: number;
  /** After the reveal: teams that got it. */
  correct: string[];
  voided: boolean;
  finished: boolean;
};

export function projectQuiz(
  bank: Bank,
  state: QuizState,
  status: "running" | "ended",
  progress: AnswerProgress = { teams: [], version: 0 },
  step = 0,
): PublicQuizView {
  const id = quizOrder(bank)[state.position];
  const q = id ? bank.questions.find((x) => x.id === id) : undefined;
  const key = questionKey(bank, state);
  const showQuestion =
    !!q && !!key && state.phase !== "ready" && state.phase !== "finished";
  const revealed = state.phase === "revealed" && !state.voided;
  return {
    kind: "sequentialQuiz",
    status,
    title: bank.title,
    phase: state.phase,
    number: state.position + 1,
    total: quizOrder(bank).length,
    points: quizPoints(bank),
    question:
      showQuestion && q && key
        ? {
            key,
            prompt: q.prompt.text,
            promptMedia: safeMediaList(q.prompt.media),
            answer: state.answerShown ? q.answer.text : null,
            answerMedia: state.answerShown ? safeMediaList(q.answer.media) : [],
          }
        : null,
    answered: progress.teams.filter((t) => state.teams.includes(t)),
    answerVersion: progress.version,
    step,
    correct: revealed
      ? state.teams.filter((t) => state.grades[t] === "correct")
      : [],
    voided: state.voided,
    finished: state.phase === "finished",
  };
}
