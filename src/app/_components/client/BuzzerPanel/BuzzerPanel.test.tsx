import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrivateGameState } from "@/types";

const calls: Record<string, ReturnType<typeof vi.fn>> = {};
const mutation = (name: string) => {
  calls[name] ??= vi.fn();
  return { mutate: calls[name], isPending: false, error: null };
};
let state: PrivateGameState;
let history: {
  past: { label: string; at: string }[];
  future: { label: string; at: string }[];
};

vi.mock("@/app/_components/client/LiveGameState", () => ({
  useLiveGameState: () => ({ data: state, status: "pending" }),
}));
vi.mock("@/trpc/react", () => ({
  api: {
    useUtils: () => ({
      gameAdmin: { buzzer: { history: { invalidate: vi.fn() } } },
    }),
    gameAdmin: {
      startBuzzer: { useMutation: () => mutation("open") },
      pauseBuzzer: { useMutation: () => mutation("close") },
      resetBuzzer: { useMutation: () => mutation("next") },
      addScore: { useMutation: () => mutation("addScore") },
      buzzer: {
        history: { useQuery: () => ({ data: history }) },
        judge: { useMutation: () => mutation("judge") },
        undo: { useMutation: () => mutation("undo") },
        redo: { useMutation: () => mutation("redo") },
        setMode: { useMutation: () => mutation("setMode") },
      },
    },
  },
}));

const { BuzzerPanel } = await import("./index");

function gameState(
  overrides: Partial<PrivateGameState["game"]> = {},
  rest: Partial<PrivateGameState> = {},
): PrivateGameState {
  const team = (id: string, name: string, index: number) => ({
    id,
    name,
    index,
    buzzerState: "available" as const,
    gameUsers: [],
    score: 0,
    allowMemberRename: true,
    nameVersion: 0,
    captainId: null,
  });
  return {
    game: {
      id: "g",
      name: "Quiz",
      code: "ABC123",
      format: "team",
      isBuzzerListening: false,
      settings: {},
      status: "running",
      finishedAt: null,
      joiningOpen: true,
      teamAssignment: "auto",
      chatEnabled: false,
      captainsOnly: false,
      buzzerMode: "first",
      ...overrides,
    },
    gameTeams: [team("t1", "Owls", 1), team("t2", "Foxes", 2)],
    gameUsers: {},
    buzzWinner: null,
    buzzQueue: [],
    mode: null,
    ...rest,
  };
}

describe("BuzzerPanel", () => {
  beforeEach(() => {
    for (const fn of Object.values(calls)) fn.mockReset();
    history = { past: [], future: [] };
    state = gameState();
  });

  it("opens a closed buzzer and can't change mode while open", async () => {
    render(<BuzzerPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Open buzzer" }));
    expect(calls.open).toHaveBeenCalled();

    state = gameState({ isBuzzerListening: true });
    render(<BuzzerPanel />);
    expect(screen.getAllByLabelText("Buzzing mode").at(-1)).toBeDisabled();
  });

  it("offers the first buzzer points and a wrong-answer reopen", async () => {
    state = gameState(
      {},
      { buzzWinner: { gameTeamId: "t2", gameUserId: null } },
    );
    render(<BuzzerPanel />);

    expect(screen.getByTestId("buzzer-headline")).toHaveTextContent(
      "Foxes buzzed first!",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Award 1 to Foxes" }),
    );
    expect(calls.addScore).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { t2: 1 } }),
      expect.anything(),
    );
    expect(
      screen.getByRole("button", { name: "Wrong: let others buzz" }),
    ).toBeVisible();
  });

  it("judges the answering team in queue mode", async () => {
    state = gameState(
      { buzzerMode: "queue", isBuzzerListening: true },
      {
        buzzQueue: [
          {
            id: "e1",
            position: 1,
            gameTeamId: "t1",
            gameUserId: "u1",
            status: "answering",
          },
          {
            id: "e2",
            position: 2,
            gameTeamId: "t2",
            gameUserId: "u2",
            status: "waiting",
          },
        ],
      },
    );
    render(<BuzzerPanel />);

    expect(screen.getByTestId("buzzer-headline")).toHaveTextContent(
      "Owls is answering",
    );
    await userEvent.click(screen.getByRole("button", { name: "Wrong: Owls" }));
    expect(calls.judge).toHaveBeenCalledWith({
      entryId: "e1",
      verdict: "wrong",
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Foxes from the queue" }),
    );
    expect(calls.judge).toHaveBeenCalledWith({
      entryId: "e2",
      verdict: "skip",
    });
  });

  it("names the action undo and redo will reverse", async () => {
    history = {
      past: [{ label: "Next question", at: new Date().toISOString() }],
      future: [{ label: "Close buzzer", at: new Date().toISOString() }],
    };
    render(<BuzzerPanel />);

    await userEvent.click(
      screen.getByRole("button", { name: "Undo: Next question" }),
    );
    expect(calls.undo).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Redo: Close buzzer" }),
    ).toBeEnabled();
  });

  it("keyboard: O opens, C judges the answering team, typing in a field does nothing", async () => {
    render(<BuzzerPanel />);
    await userEvent.keyboard("o");
    expect(calls.open).toHaveBeenCalledTimes(1);

    state = gameState(
      { buzzerMode: "queue", isBuzzerListening: true },
      {
        buzzQueue: [
          {
            id: "e1",
            position: 1,
            gameTeamId: "t1",
            gameUserId: "u1",
            status: "answering",
          },
        ],
      },
    );
    const { unmount } = render(<BuzzerPanel />);
    await userEvent.keyboard("c");
    expect(calls.judge).toHaveBeenCalledWith({
      entryId: "e1",
      verdict: "correct",
    });
    calls.judge!.mockReset();
    // Typing points into a field is not a shortcut.
    await userEvent.type(screen.getAllByLabelText("Points")[0]!, "w");
    expect(calls.judge).not.toHaveBeenCalled();
    unmount();
  });
});
