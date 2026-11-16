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

// Super/subscripts and vulgar fractions change a number's meaning ("10²"
// isn't "102", "½" isn't "12"), so compatibility folding skips them.
const KEEP_UNFOLDED =
  /([\u00B2\u00B3\u00B9\u00BC-\u00BE\u2070-\u209F\u2150-\u215F\u2189]+)/u;

/**
 * Text for grouping identical answers, and for "Mark exact matches
 * correct": case, spaces, punctuation and accents on Latin letters are
 * ignored. Anything that changes meaning is kept: other scripts' marks
 * ("かぎ" isn't "かき"), a minus sign or separator in a number ("-40",
 * "3.5", "3/5") and super/subscripts. An answer with no letters or digits
 * is compared as typed, so different symbols never share a group.
 */
export function normalizeAnswer(text: string) {
  const key = text
    .split(KEEP_UNFOLDED)
    .map((part, i) => (i % 2 ? part : part.normalize("NFKC")))
    .join("")
    .toLowerCase()
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(
      /((?<=\p{N})[.,/:-](?=\p{N})|-(?=\p{N}))|[^\p{L}\p{M}\p{N}]/gu,
      (_, kept?: string) => kept ?? " ",
    )
    .replace(/ {2,}/g, " ")
    .trim()
    .normalize("NFC");
  return key || text.normalize("NFC").trim();
}
