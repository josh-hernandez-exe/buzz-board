/**
 * The question library: every question in a bank, and where each is used
 * (grid tiles and quiz positions). Pure helpers shared by the grid and quiz
 * editors. Editing a question changes every use; removing a use never
 * deletes a question somebody wrote, and a question in use can't be deleted.
 */
import { err, ok, type Result } from "neverthrow";

import {
  GRID_LIMITS,
  gridOf,
  type Bank,
  type Question,
} from "@/utils/categoryGrid/content";

export type QuestionUse =
  | {
      kind: "grid";
      columnId: string;
      column: string;
      row: number;
      label: string;
    }
  | { kind: "quiz"; position: number };

/** Every use of every question, keyed by question ID. */
export function questionUses(bank: Bank): Map<string, QuestionUse[]> {
  const uses = new Map<string, QuestionUse[]>();
  const add = (id: string, use: QuestionUse) =>
    uses.set(id, [...(uses.get(id) ?? []), use]);
  gridOf(bank).columns.forEach((c, ci) =>
    c.cells.forEach((cell, row) =>
      add(cell.questionId, {
        kind: "grid",
        columnId: c.id,
        column: c.title || `Category ${ci + 1}`,
        row,
        label: cell.label || `row ${row + 1}`,
      }),
    ),
  );
  (bank.modes.pubQuiz?.questionOrder ?? []).forEach((id, position) =>
    add(id, { kind: "quiz", position }),
  );
  return uses;
}

export function describeUse(use: QuestionUse): string {
  return use.kind === "grid"
    ? `Grid: ${use.column} ${use.label}`
    : `Quiz #${use.position + 1}`;
}

/** Nothing written in it yet: no text, media, alternatives or notes. */
export function isBlankQuestion(q: Question): boolean {
  return (
    !q.prompt.text &&
    !q.answer.text &&
    !q.prompt.media?.length &&
    !q.answer.media?.length &&
    !q.answer.acceptedAnswers?.length &&
    !q.hostNotes
  );
}

/** A fresh question ID: q1, q2, … skipping any already taken. */
export function nextQuestionId(bank: Bank, prefix = "q"): string {
  const taken = new Set([
    ...bank.questions.map((q) => q.id),
    ...gridOf(bank).columns.map((c) => c.id),
  ]);
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) return id;
  }
}

export type LibraryError =
  | { kind: "libraryFull" }
  | { kind: "questionNotFound" }
  | { kind: "questionInUse"; uses: QuestionUse[] };

export function addQuestion(
  bank: Bank,
  question?: Omit<Question, "id">,
): Result<{ bank: Bank; id: string }, LibraryError> {
  if (bank.questions.length >= GRID_LIMITS.maxQuestions) {
    return err({ kind: "libraryFull" });
  }
  const id = nextQuestionId(bank);
  const q: Question = {
    ...(question ?? { prompt: { text: "" }, answer: { text: "" } }),
    id,
  };
  return ok({ bank: { ...bank, questions: [...bank.questions, q] }, id });
}

/** A copy of a question, unused, right after the original. */
export function duplicateQuestion(
  bank: Bank,
  id: string,
): Result<{ bank: Bank; id: string }, LibraryError> {
  const original = bank.questions.find((q) => q.id === id);
  if (!original) return err({ kind: "questionNotFound" });
  if (bank.questions.length >= GRID_LIMITS.maxQuestions) {
    return err({ kind: "libraryFull" });
  }
  const copyId = nextQuestionId(bank);
  const copy: Question = { ...structuredClone(original), id: copyId };
  const at = bank.questions.indexOf(original) + 1;
  const questions = [...bank.questions];
  questions.splice(at, 0, copy);
  return ok({ bank: { ...bank, questions }, id: copyId });
}

/** Deletes a question nobody uses. A question in use is never deleted. */
export function deleteQuestion(
  bank: Bank,
  id: string,
): Result<Bank, LibraryError> {
  if (!bank.questions.some((q) => q.id === id)) {
    return err({ kind: "questionNotFound" });
  }
  const uses = questionUses(bank).get(id) ?? [];
  if (uses.length > 0) return err({ kind: "questionInUse", uses });
  return ok({ ...bank, questions: bank.questions.filter((q) => q.id !== id) });
}

/**
 * After uses were removed (a grid row or column, say): drops the questions
 * among `ids` that are now unused and still blank. Anything written stays
 * in the library, so removing a tile never loses work.
 */
export function pruneBlankUnused(bank: Bank, ids: Iterable<string>): Bank {
  const uses = questionUses(bank);
  const candidates = new Set(ids);
  return {
    ...bank,
    questions: bank.questions.filter(
      (q) =>
        !candidates.has(q.id) ||
        (uses.get(q.id)?.length ?? 0) > 0 ||
        !isBlankQuestion(q),
    ),
  };
}

/** Case- and accent-insensitive search over prompt, answer, notes and ID. */
export function matchesSearch(q: Question, search: string): boolean {
  const fold = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const needle = fold(search.trim());
  if (!needle) return true;
  return [
    q.id,
    q.prompt.text,
    q.answer.text,
    q.hostNotes ?? "",
    ...(q.answer.acceptedAnswers ?? []),
  ].some((s) => fold(s).includes(needle));
}
