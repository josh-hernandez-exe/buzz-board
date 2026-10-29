import { describe, expect, it } from "vitest";

import type { PrivateGameState } from "@/types";

import { buzzerStatus, captainFor, noBuzzerTurn } from "./buzzerStatus";

function state(
  overrides: {
    game?: Partial<PrivateGameState["game"]>;
    buzzWinner?: PrivateGameState["buzzWinner"];
    rejected?: string[];
    selfTeam?: string | null;
    captain?: string | null;
    queue?: PrivateGameState["buzzQueue"];
  } = {},
): PrivateGameState {
  const rejected = new Set(overrides.rejected ?? []);
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
      ...overrides.game,
    },
    gameTeams: ["t1", "t2"].map((id, i) => ({
      id,
      name: id === "t1" ? "Owls" : "Foxes",
      index: i + 1,
      buzzerState: rejected.has(id) ? "rejected" : "available",
      gameUsers: [],
      score: 0,
      allowMemberRename: true,
      nameVersion: 0,
      captainId: id === "t1" ? (overrides.captain ?? null) : "rival",
    })),
    gameUsers: {
      me: {
        id: "me",
        name: "Ada",
        index: 1,
        gameTeamId:
          overrides.selfTeam === undefined ? "t1" : overrides.selfTeam,
        image: null,
        allowSelfRename: true,
        nameVersion: 0,
      },
      mate: {
        id: "mate",
        name: "Cy",
        index: 2,
        gameTeamId: "t1",
        image: null,
        allowSelfRename: true,
        nameVersion: 0,
      },
      rival: {
        id: "rival",
        name: "Bo",
        index: 3,
        gameTeamId: "t2",
        image: null,
        allowSelfRename: true,
        nameVersion: 0,
      },
    },
    buzzWinner: overrides.buzzWinner ?? null,
    buzzQueue: overrides.queue ?? [],
    mode: null,
  };
}

const entry = (
  position: number,
  gameUserId: string,
  gameTeamId: string,
  status: PrivateGameState["buzzQueue"][number]["status"],
) => ({ id: `e${position}`, position, gameUserId, gameTeamId, status });

describe("buzzerStatus", () => {
  it("is ready only while the buzzer is open", () => {
    expect(
      buzzerStatus(state({ game: { isBuzzerListening: true } }), "me"),
    ).toEqual({
      canBuzz: true,
      tone: "ready",
      message: "Buzzer open: press now!",
    });
    expect(buzzerStatus(state(), "me")).toMatchObject({
      canBuzz: false,
      message: "Buzzer closed. Wait for the host to open it.",
    });
  });

  it("congratulates the winner and their teammates", () => {
    const won = state({ buzzWinner: { gameUserId: "me", gameTeamId: "t1" } });
    expect(buzzerStatus(won, "me").message).toBe("You buzzed in first!");
    expect(buzzerStatus(won, "mate").message).toBe(
      "Your team buzzed in first!",
    );
  });

  it("names the team that buzzed first for everyone else", () => {
    const won = state({
      buzzWinner: { gameUserId: "rival", gameTeamId: "t2" },
    });
    expect(buzzerStatus(won, "me")).toMatchObject({
      canBuzz: false,
      message: "Foxes buzzed in first.",
    });
  });

  it("names the player in individual games", () => {
    const won = state({
      game: { format: "individual" },
      buzzWinner: { gameUserId: "rival", gameTeamId: "t2" },
    });
    expect(buzzerStatus(won, "me").message).toBe("Bo buzzed in first.");
  });

  it("explains a rejected team even while the buzzer is open", () => {
    const s = state({ game: { isBuzzerListening: true }, rejected: ["t1"] });
    expect(buzzerStatus(s, "me")).toMatchObject({
      canBuzz: false,
      message: "Your team already had its turn this round.",
    });
  });

  it("explains a missing team according to the team policy", () => {
    expect(buzzerStatus(state({ selfTeam: null }), "me").message).toBe(
      "Pick a team to play.",
    );
    expect(
      buzzerStatus(
        state({ selfTeam: null, game: { teamAssignment: "staff" } }),
        "me",
      ).message,
    ).toBe("Waiting for your host to put you on a team.");
  });

  it("explains that a finished game cannot be played", () => {
    expect(
      buzzerStatus(
        state({ game: { status: "finished", isBuzzerListening: true } }),
        "me",
      ),
    ).toMatchObject({ canBuzz: false, tone: "blocked" });
  });

  describe("queue mode", () => {
    const queue = (q: PrivateGameState["buzzQueue"], listening = true) =>
      state({
        game: { buzzerMode: "queue", isBuzzerListening: listening },
        queue: q,
      });

    it("invites a buzz to join the queue", () => {
      expect(buzzerStatus(queue([]), "me")).toMatchObject({
        canBuzz: true,
        message: "Buzzer open: press to join the queue!",
      });
    });

    it("says who is answering, and the player's place in line", () => {
      expect(
        buzzerStatus(queue([entry(1, "me", "t1", "answering")]), "me").message,
      ).toBe("You're answering!");
      expect(
        buzzerStatus(queue([entry(1, "mate", "t1", "answering")]), "me")
          .message,
      ).toBe("Your team is answering (Cy buzzed)!");
      expect(
        buzzerStatus(
          queue([
            entry(1, "rival", "t2", "answering"),
            entry(2, "me", "t1", "waiting"),
          ]),
          "me",
        ),
      ).toMatchObject({ canBuzz: false, message: "You're next in line." });
      expect(
        buzzerStatus(
          queue([
            entry(1, "x", "t3", "wrong"),
            entry(2, "rival", "t2", "answering"),
            entry(3, "y", "t4", "waiting"),
            entry(4, "mate", "t1", "waiting"),
          ]),
          "me",
        ).message,
      ).toBe("Your team is 3rd in line (Cy buzzed).");
    });

    it("explains a lockout, a win, and another team's win", () => {
      expect(
        buzzerStatus(queue([entry(1, "me", "t1", "wrong")]), "me").message,
      ).toBe("Not this time: your team sits out until the next question.");
      expect(
        buzzerStatus(queue([entry(1, "me", "t1", "correct")], false), "me")
          .message,
      ).toBe("Correct! Well done.");
      expect(
        buzzerStatus(queue([entry(1, "rival", "t2", "correct")], false), "me")
          .message,
      ).toBe("Foxes got it.");
    });
  });

  it("lets only the captain press in a captains-only game", () => {
    const open = (captainsOnly: boolean) =>
      state({
        game: { isBuzzerListening: true, captainsOnly },
        captain: "mate",
      });
    expect(buzzerStatus(open(true), "me")).toEqual({
      canBuzz: false,
      tone: "waiting",
      message: "Buzzer open: only your captain, Cy, can buzz.",
    });
    expect(buzzerStatus(open(true), "mate").canBuzz).toBe(true);
    expect(buzzerStatus(open(false), "me").canBuzz).toBe(true);
    expect(captainFor(open(true), "me")).toBe("Cy");
    expect(captainFor(open(true), "mate")).toBeNull();
    // Team news still reaches everyone on the team.
    const won = state({
      game: { captainsOnly: true },
      captain: "mate",
      buzzWinner: { gameUserId: "mate", gameTeamId: "t1" },
    });
    expect(buzzerStatus(won, "me").message).toBe("Your team buzzed in first!");
    // No captain yet (an empty team just joined): nobody is locked out.
    expect(
      buzzerStatus(
        state({ game: { isBuzzerListening: true, captainsOnly: true } }),
        "me",
      ).canBuzz,
    ).toBe(true);
  });
});

describe("noBuzzerTurn (Ranked Answers without a buzzer)", () => {
  const withBoard = (
    playStyle: string,
    phase: string,
    currentTeam: string | null,
    listening = false,
  ) => {
    const s = state({ game: { isBuzzerListening: listening } });
    return {
      ...s,
      mode: {
        kind: "rankedAnswers",
        status: "running",
        playStyle,
        board: { phase, currentTeam },
      },
    } as unknown as PrivateGameState;
  };

  it("tells the team whose turn it is, and everyone else whose turn it is", () => {
    expect(noBuzzerTurn(withBoard("roundRobin", "turns", "t1"), "me")).toEqual({
      mine: true,
      message: "Your team's turn! Say your answer.",
    });
    expect(noBuzzerTurn(withBoard("roundRobin", "turns", "t2"), "me")).toEqual({
      mine: false,
      message: "Foxes's turn. No buzzer: wait for your team's turn.",
    });
  });

  it("keeps the Buzz button for buzzer styles, closed boards, or an open buzzer", () => {
    expect(noBuzzerTurn(withBoard("buzzRace", "race", null), "me")).toBeNull();
    expect(
      noBuzzerTurn(withBoard("faceOffLadder", "faceOff", null), "me"),
    ).toBeNull();
    expect(
      noBuzzerTurn(withBoard("roundRobin", "closed", null), "me"),
    ).toBeNull();
    expect(
      noBuzzerTurn(withBoard("roundRobin", "turns", "t1", true), "me"),
    ).toBeNull();
    expect(noBuzzerTurn(state(), "me")).toBeNull();
  });

  it("all-play and open answering: no turns, no buzzer", () => {
    expect(
      noBuzzerTurn(withBoard("allPlay", "allPlay", null), "me"),
    ).toMatchObject({
      mine: false,
    });
  });
});
