/**
 * Sequential Quiz content: the shared question bank with its quiz layout
 * (`modes.pubQuiz`: questions in play order and points for each).
 */
import {
  emptyBank,
  questionProblems,
  type Bank,
} from "@/utils/categoryGrid/content";

export const QUIZ_LIMITS = { maxQuestions: 200, maxAnswerLength: 500 } as const;

/** A quiz-only bank: no grid, an empty order. */
export function emptyQuizBank(): Bank {
  const { modes: _modes, ...rest } = emptyBank(1, 1);
  return {
    ...rest,
    title: "Quiz",
    questions: [],
    modes: { pubQuiz: { questionOrder: [], pointsPerQuestion: 1 } },
  };
}

export function quizPreflight(bank: Bank, teamCount: number) {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const order = bank.modes.pubQuiz?.questionOrder ?? [];
  if (teamCount < 1) blocking.push("Add at least one team or player.");
  if (order.length === 0)
    blocking.push("Add at least one question to the quiz.");
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  if (byId.size !== bank.questions.length) {
    blocking.push("Two questions share an ID.");
  }
  order.forEach((id, i) => {
    const q = byId.get(id);
    const where = `Question ${i + 1}`;
    if (!q) blocking.push(`${where}: question "${id}" doesn't exist.`);
    else blocking.push(...questionProblems(q).map((p) => `${where}: ${p}`));
  });
  if (new Set(order).size !== order.length) {
    warnings.push("A question appears more than once in the quiz.");
  }
  const unused = bank.questions.filter((q) => !order.includes(q.id)).length;
  if (unused > 0) {
    warnings.push(
      `${unused} question${unused === 1 ? " isn't" : "s aren't"} in the quiz (kept in the bank).`,
    );
  }
  if (teamCount > 40) {
    warnings.push(
      "Marking typed answers for over 40 teams takes a while: play in teams to keep it quick.",
    );
  }
  return { blocking, warnings };
}

/** Text for grouping identical answers: case, spaces and punctuation ignored. */
export function normalizeAnswer(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
