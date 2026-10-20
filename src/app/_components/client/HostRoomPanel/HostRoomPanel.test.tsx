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

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_QRCODE_BASE_URL: "https://buzz.example" },
}));
vi.mock("qrcode", () => ({ toCanvas: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/_components/client/LiveGameState", () => ({
  useLiveGameState: () => ({
    data: state,
    status: "pending",
    hasLiveData: true,
  }),
}));
vi.mock("@/trpc/react", () => ({
  api: {
    gameAdmin: new Proxy(
      {},
      { get: (_t, name: string) => ({ useMutation: () => mutation(name) }) },
    ),
  },
}));

const { HostRoomPanel } = await import("./index");

function gameState(game: Partial<PrivateGameState["game"]> = {}, players = 0) {
  state = {
    game: {
      id: "g1",
      name: "Quiz night",
      code: "ABC123",
      format: "team",
      isBuzzerListening: false,
      settings: {},
      status: "lobby",
      finishedAt: null,
      joiningOpen: true,
      teamAssignment: "auto",
      ...game,
    },
    gameTeams: [],
    gameUsers: Object.fromEntries(
      Array.from({ length: players }, (_, i) => [
        `u${i}`,
        { id: `u${i}`, name: `P${i}`, index: i, gameTeamId: null, image: null },
      ]),
    ),
    buzzWinner: null,
  };
}

describe("HostRoomPanel", () => {
  beforeEach(() => {
    for (const fn of Object.values(calls)) fn.mockReset();
    gameState();
  });

  it("shows the join code, status and audience display link", () => {
    render(<HostRoomPanel isOwner />);

    expect(screen.getByTestId("join-code")).toHaveTextContent("ABC123");
    expect(screen.getByTestId("game-status")).toHaveTextContent("Lobby");
    expect(
      screen.getByRole("link", { name: "Open audience display" }),
    ).toHaveAttribute("href", "/game/g1/scoreboard/public");
  });

  it("only offers delete to the owner", () => {
    const { rerender } = render(<HostRoomPanel isOwner={false} />);
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();

    rerender(<HostRoomPanel isOwner />);
    expect(screen.getByRole("button", { name: "Delete…" })).toBeVisible();
  });

  it("requires the exact game name before deleting", async () => {
    gameState({ status: "finished", finishedAt: new Date() }, 3);
    render(<HostRoomPanel isOwner />);

    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    const confirm = screen.getByRole("button", { name: "Delete forever" });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("Game name to confirm deletion"),
      "Quiz night",
    );
    await userEvent.click(confirm);

    expect(calls.deleteGame).toHaveBeenCalledWith({
      confirmName: "Quiz night",
    });
  });

  it("explains why a game in play cannot be deleted", async () => {
    gameState({ status: "running" }, 2);
    render(<HostRoomPanel isOwner />);

    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));

    expect(screen.getByText(/Finish the game first/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Delete forever" }),
    ).toBeDisabled();
  });

  it("offers reopen only within 24 hours of finishing", () => {
    gameState({
      status: "finished",
      finishedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    render(<HostRoomPanel isOwner />);

    expect(
      screen.getByRole("button", { name: "Reopen to correct results" }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Finish game…" })).toBeNull();
  });

  it("changes the team policy", async () => {
    render(<HostRoomPanel isOwner />);

    await userEvent.selectOptions(
      screen.getByLabelText("Team assignment for new players"),
      "staff",
    );

    expect(calls.setTeamAssignment).toHaveBeenCalledWith({
      teamAssignment: "staff",
    });
  });
});
