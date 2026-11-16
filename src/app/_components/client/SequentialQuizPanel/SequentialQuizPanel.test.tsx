import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Bank } from "@/utils/categoryGrid/content";
import { quizPreflight } from "@/utils/sequentialQuiz/content";
import { sampleQuizBank } from "@/utils/sequentialQuiz/sample";

// Any path on `api.useUtils()` is callable and resolves.
const anything = (): unknown =>
  new Proxy(() => Promise.resolve(), {
    get: (_t, key) => (key === "then" ? undefined : anything()),
  });
const mutation = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  error: null,
});
let hostView: unknown;

vi.mock("@/app/_components/client/LiveGameState", () => ({
  useLiveGameState: () => ({ data: null }),
}));
vi.mock("@/trpc/react", () => ({
  api: {
    useUtils: anything,
    sequentialQuiz: new Proxy(
      {},
      {
        get: (_t, name: string) =>
          name === "hostView"
            ? { useQuery: () => ({ data: hostView, error: null }) }
            : { useMutation: mutation, useQuery: () => ({}) },
      },
    ),
  },
}));

const { SequentialQuizPanel } = await import("./index");

function viewFor(gameId: string, firstPrompt: string) {
  const bank = sampleQuizBank();
  const first = bank.modes.pubQuiz!.questionOrder[0];
  const draft: Bank = {
    ...bank,
    questions: bank.questions.map((q) =>
      q.id === first ? { ...q, prompt: { ...q.prompt, text: firstPrompt } } : q,
    ),
  };
  return {
    gameId,
    status: "draft",
    otherMode: null,
    draft,
    // Both games at the same revision: the editor can't tell them apart by it.
    draftRevision: 1,
    preflight: quizPreflight(draft, 2),
    content: null,
    state: null,
    step: 0,
    canUndo: false,
    teams: [],
    view: null,
  };
}

describe("SequentialQuizPanel", () => {
  it("never edits a quiz cached from another game's host desk", () => {
    hostView = viewFor("game-a", "Question from game A");
    const { rerender } = render(<SequentialQuizPanel gameId="game-b" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Question from game A")).not.toBeInTheDocument();

    // This game's view arrives: the editor shows it, not the cached one.
    hostView = viewFor("game-b", "Question from game B");
    rerender(<SequentialQuizPanel gameId="game-b" />);
    expect(screen.getByText("Question from game B")).toBeInTheDocument();
    expect(screen.queryByText("Question from game A")).not.toBeInTheDocument();
  });
});
