import { describe, expect, it } from "vitest";

import { applyGrid, initialGridState } from "@/utils/categoryGrid/engine";
import { projectGrid } from "@/utils/categoryGrid/projection";
import { sampleBank } from "@/utils/categoryGrid/sample";
import { modeSoundCues } from "@/utils/modeSounds";
import { presetRules } from "@/utils/rankedAnswers/content";
import { apply, initialState, type Action } from "@/utils/rankedAnswers/engine";
import { projectPublic } from "@/utils/rankedAnswers/projection";
import { sampleContent } from "@/utils/rankedAnswers/sample";

describe("mode sound cues", () => {
  const content = {
    ...sampleContent(2),
    rules: { ...presetRules("classic", 2), faceOffMethod: "none" as const },
  };
  const views = (actions: Action[]) => {
    let state = initialState(["A", "B"]);
    const out = [projectPublic(content, state, "running")];
    for (const a of actions) {
      state = apply(content, state, a)._unsafeUnwrap().state;
      out.push(projectPublic(content, state, "running"));
    }
    return out;
  };

  it("Ranked Answers: a chime for a found answer, a buzz for a strike, nothing for leftovers", () => {
    const [, started, found, struck] = views([
      { type: "startBoard", boardId: "tree" },
      { type: "answer", answerId: content.boards[1]!.answers[0]!.id },
      { type: "answer", answerId: null },
    ]);
    expect(modeSoundCues(started!, found!)).toEqual(["reveal"]);
    expect(modeSoundCues(found!, struck!)).toEqual(["strike"]);
    const [, , closed, leftovers] = views([
      { type: "startBoard", boardId: "tree" },
      { type: "closeBoard" },
      { type: "revealRemaining" },
    ]);
    expect(modeSoundCues(closed!, leftovers!)).toEqual([]);
    // A new board, or the first view on page load, is silent.
    expect(modeSoundCues(null, started!)).toEqual([]);
  });

  it("Category Grid: a buzz for a wrong answer, a fanfare for a right one, a chime when shown", () => {
    const bank = sampleBank();
    let state = initialGridState(["A", "B"]);
    const step = (a: Parameters<typeof applyGrid>[2]) => {
      const before = projectGrid(bank, state, "running");
      state = applyGrid(bank, state, a)._unsafeUnwrap().state;
      return modeSoundCues(before, projectGrid(bank, state, "running"));
    };
    expect(step({ type: "openClue", cell: "cat1:0" })).toEqual([]);
    expect(step({ type: "judge", team: "A", correct: false })).toEqual([
      "strike",
    ]);
    expect(step({ type: "judge", team: "B", correct: true })).toEqual([
      "correct",
    ]);
    step({ type: "closeClue" });
    step({ type: "openClue", cell: "cat1:1" });
    expect(step({ type: "revealAnswer" })).toEqual(["reveal"]);
  });
});
