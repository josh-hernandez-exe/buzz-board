import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrivateGameState } from "@/types";

let state: PrivateGameState | undefined;
let self: { id: string; gameTeamId: string | null } | undefined;

vi.mock("@/app/_components/client/LiveGameState", () => ({
  useLiveGameState: () => ({
    data: state,
    status: "pending",
    hasLiveData: true,
  }),
}));
vi.mock("@/trpc/react", () => ({
  api: {
    gameUser: { getSelfInfo: { useQuery: () => ({ data: self }) } },
  },
}));

const { GameWhoBuzzedIn } = await import("./index");

function gameState(
  overrides: Partial<PrivateGameState> & {
    format?: "team" | "individual";
    isBuzzerListening?: boolean;
  } = {},
): PrivateGameState {
  const { format = "team", isBuzzerListening = false, ...rest } = overrides;
  return {
    game: {
      id: "g",
      name: "Game",
      code: "ABC123",
      format,
      isBuzzerListening,
      settings: {},
      status: "running",
      finishedAt: null,
      joiningOpen: true,
      teamAssignment: "auto",
      chatEnabled: false,
    },
    gameTeams: [
      {
        id: "t1",
        name: "Owls",
        index: 1,
        buzzerState: "selected",
        gameUsers: ["u1"],
        score: 0,
        allowMemberRename: true,
        nameVersion: 0,
      },
      {
        id: "t2",
        name: "Foxes",
        index: 2,
        buzzerState: "available",
        gameUsers: ["u2"],
        score: 0,
        allowMemberRename: true,
        nameVersion: 0,
      },
    ],
    gameUsers: {
      u1: {
        id: "u1",
        name: "Ada",
        index: 1,
        gameTeamId: "t1",
        image: null,
        allowSelfRename: true,
        nameVersion: 0,
      },
      u2: {
        id: "u2",
        name: "Bo",
        index: 2,
        gameTeamId: "t2",
        image: null,
        allowSelfRename: true,
        nameVersion: 0,
      },
    },
    buzzWinner: null,
    mode: null,
    ...rest,
  };
}

describe("GameWhoBuzzedIn", () => {
  beforeEach(() => {
    state = undefined;
    self = undefined;
  });

  it("names the winner and the team they buzzed for", () => {
    state = gameState({ buzzWinner: { gameUserId: "u1", gameTeamId: "t1" } });

    render(<GameWhoBuzzedIn />);

    expect(
      screen.getByText("[Ada] from [Owls] has buzzed in."),
    ).toBeInTheDocument();
  });

  it("tells the winner it was them", () => {
    state = gameState({ buzzWinner: { gameUserId: "u1", gameTeamId: "t1" } });
    self = { id: "u1", gameTeamId: "t1" };

    render(<GameWhoBuzzedIn gameUserId="u1" />);

    expect(screen.getByText("You have buzzed in!")).toBeInTheDocument();
  });

  it("tells teammates their team buzzed", () => {
    state = gameState({ buzzWinner: { gameUserId: "u1", gameTeamId: "t1" } });
    self = { id: "u3", gameTeamId: "t1" };

    render(<GameWhoBuzzedIn gameUserId="u3" />);

    expect(
      screen.getByText("[Ada] from your team has buzzed in."),
    ).toBeInTheDocument();
  });

  it("keeps the claim's team after the winner moves teams", () => {
    const moved = gameState({
      buzzWinner: { gameUserId: "u1", gameTeamId: "t1" },
    });
    moved.gameUsers.u1!.gameTeamId = "t2";
    state = moved;

    render(<GameWhoBuzzedIn />);

    expect(
      screen.getByText("[Ada] from [Owls] has buzzed in."),
    ).toBeInTheDocument();
  });

  it("shows only the team for a winner recorded before claims existed", () => {
    state = gameState({ buzzWinner: { gameUserId: null, gameTeamId: "t1" } });

    render(<GameWhoBuzzedIn />);

    expect(screen.getByText("[Owls] has buzzed in.")).toBeInTheDocument();
  });

  it("omits the team in individual games", () => {
    state = gameState({
      format: "individual",
      buzzWinner: { gameUserId: "u2", gameTeamId: "t2" },
    });

    render(<GameWhoBuzzedIn />);

    expect(screen.getByText("[Bo] has buzzed in.")).toBeInTheDocument();
  });

  it.each([
    [true, "Buzzer is listening and no one has buzzed in yet."],
    [false, "Buzzer is not listening."],
  ])(
    "shows the buzzer status when nobody has buzzed (listening: %s)",
    (listening, text) => {
      state = gameState({ isBuzzerListening: listening });

      render(<GameWhoBuzzedIn />);

      expect(screen.getByText(text)).toBeInTheDocument();
    },
  );
});
