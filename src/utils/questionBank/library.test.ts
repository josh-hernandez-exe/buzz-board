import { describe, expect, it } from "vitest";

import { bankSchema, emptyBank, type Bank } from "@/utils/categoryGrid/content";
import { sampleBank } from "@/utils/categoryGrid/sample";

import {
  addQuestion,
  deleteQuestion,
  describeUse,
  duplicateQuestion,
  matchesSearch,
  nextQuestionId,
  pruneBlankUnused,
  questionUses,
  renameQuestion,
} from "./library";

/** The sample grid, with a quiz that reuses two of its clues. */
function shared(): Bank {
  const b = sampleBank();
  return {
    ...b,
    modes: {
      ...b.modes,
      pubQuiz: { questionOrder: ["cat1-1", "cat2-1"], pointsPerQuestion: 1 },
    },
  };
}

describe("question library", () => {
  it("lists every use of a question across the grid and the quiz", () => {
    const uses = questionUses(shared());
    expect(uses.get("cat1-1")?.map(describeUse)).toEqual([
      "Grid: Winter Science 100",
      "Quiz #1",
    ]);
    expect(uses.get("cat1-2")?.map(describeUse)).toEqual([
      "Grid: Winter Science 200",
    ]);
  });

  it("never deletes a question in use, and deletes an unused one", () => {
    const bank = shared();
    expect(deleteQuestion(bank, "cat1-1")._unsafeUnwrapErr()).toMatchObject({
      kind: "questionInUse",
    });
    const added = addQuestion(bank)._unsafeUnwrap();
    const after = deleteQuestion(added.bank, added.id)._unsafeUnwrap();
    expect(after.questions).toHaveLength(bank.questions.length);
    expect(deleteQuestion(bank, "nope").isErr()).toBe(true);
  });

  it("adds and duplicates with fresh IDs, within the limit", () => {
    const bank = shared();
    const copy = duplicateQuestion(bank, "cat1-1")._unsafeUnwrap();
    const index = copy.bank.questions.findIndex((q) => q.id === copy.id);
    expect(copy.bank.questions[index - 1]!.id).toBe("cat1-1");
    expect(copy.bank.questions[index]).toMatchObject({
      prompt: bank.questions[0]!.prompt,
      answer: bank.questions[0]!.answer,
    });
    // Unused until placed.
    expect(questionUses(copy.bank).get(copy.id)).toBeUndefined();
    expect(bankSchema.safeParse(copy.bank).success).toBe(true);

    const full: Bank = {
      ...bank,
      questions: Array.from({ length: 200 }, (_x, i) => ({
        id: `x${i}`,
        prompt: { text: "" },
        answer: { text: "" },
      })),
    };
    expect(addQuestion(full)._unsafeUnwrapErr()).toEqual({
      kind: "libraryFull",
    });
  });

  it("avoids IDs used by questions and categories", () => {
    const bank = emptyBank(1, 1);
    expect(nextQuestionId(bank, "c")).toBe("c2");
    expect(nextQuestionId(bank)).toBe("q1");
  });

  it("after removing uses, keeps written questions and drops blank ones", () => {
    const bank = emptyBank(2, 1);
    const written = bank.questions[0]!.id;
    const blank = bank.questions[1]!.id;
    bank.questions[0] = {
      ...bank.questions[0]!,
      prompt: { text: "Keep me" },
    };
    const noGrid: Bank = { ...bank, modes: {} };
    const pruned = pruneBlankUnused(noGrid, [written, blank]);
    expect(pruned.questions.map((q) => q.id)).toEqual([written]);
    // Still used elsewhere: kept even when blank.
    const quiz: Bank = {
      ...noGrid,
      modes: { pubQuiz: { questionOrder: [blank], pointsPerQuestion: 1 } },
    };
    expect(pruneBlankUnused(quiz, [blank]).questions).toHaveLength(2);
  });

  it("searches text, answers, alternatives, notes and IDs, ignoring accents", () => {
    const q = {
      id: "noel-1",
      prompt: { text: "Which carol?" },
      answer: { text: "Noël", acceptedAnswers: ["The First Noel"] },
      hostNotes: "Sung in December",
    };
    for (const s of ["noel", "CAROL", "first", "december", "noel-1", ""]) {
      expect(matchesSearch(q, s)).toBe(true);
    }
    expect(matchesSearch(q, "easter")).toBe(false);
  });

  it("renames an ID everywhere it's used, refusing bad or taken IDs", () => {
    const bank = shared();
    const renamed = renameQuestion(bank, "cat1-1", "snowflake")._unsafeUnwrap();
    expect(renamed.questions.some((q) => q.id === "cat1-1")).toBe(false);
    expect(questionUses(renamed).get("snowflake")?.map(describeUse)).toEqual([
      "Grid: Winter Science 100",
      "Quiz #1",
    ]);
    expect(questionUses(renamed).get("cat1-1")).toBeUndefined();
    expect(bankSchema.safeParse(renamed).success).toBe(true);
    expect(renameQuestion(bank, "cat1-1", "cat1-2")._unsafeUnwrapErr()).toEqual(
      {
        kind: "idTaken",
      },
    );
    expect(renameQuestion(bank, "cat1-1", "cat1")._unsafeUnwrapErr()).toEqual({
      kind: "idTaken",
    });
    expect(
      renameQuestion(bank, "cat1-1", "has space")._unsafeUnwrapErr(),
    ).toEqual({
      kind: "invalidId",
    });
    expect(renameQuestion(bank, "nope", "x").isErr()).toBe(true);
  });
});
