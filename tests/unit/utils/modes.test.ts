import { describe, expect, it } from "vitest";

import { initialGridState } from "@/utils/categoryGrid/engine";
import { sampleBank } from "@/utils/categoryGrid/sample";
import { isModeKind, publicGameModeView } from "@/utils/modes";
import { initialState } from "@/utils/rankedAnswers/engine";
import { sampleContent } from "@/utils/rankedAnswers/sample";

describe("publicGameModeView", () => {
  it("projects each known mode by kind", () => {
    expect(
      publicGameModeView({
        kind: "rankedAnswers",
        status: "running",
        content: sampleContent(2),
        state: initialState(["a", "b"]),
      })?.kind,
    ).toBe("rankedAnswers");
    expect(
      publicGameModeView({
        kind: "categoryGrid",
        status: "ended",
        content: sampleBank(),
        state: initialGridState(["a", "b"]),
      }),
    ).toMatchObject({ kind: "categoryGrid", status: "ended" });
  });

  it("never breaks the game for an unknown mode or unreadable content", () => {
    const base = { status: "running", state: {} };
    expect(
      publicGameModeView({ ...base, kind: "quizMaze", content: { rooms: [] } }),
    ).toBeNull();
    expect(
      publicGameModeView({
        ...base,
        kind: "rankedAnswers",
        content: { nope: 1 },
      }),
    ).toBeNull();
    expect(
      publicGameModeView({ ...base, kind: "categoryGrid", content: "garbage" }),
    ).toBeNull();
    expect(
      publicGameModeView({
        kind: "rankedAnswers",
        status: "running",
        content: sampleContent(2),
        state: null,
      }),
    ).toBeNull();
    expect(isModeKind("quizMaze")).toBe(false);
  });
});
