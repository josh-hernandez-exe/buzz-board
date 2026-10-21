import { BuzzerState, GameFormat, GameStatus } from "@prisma/client";

import type { PrivateGameState } from "@/types";

export type BuzzerStatus = {
  /** Whether pressing the buzzer can currently succeed. */
  canBuzz: boolean;
  message: string;
  tone: "ready" | "waiting" | "won" | "blocked";
};

/**
 * What a player's buzzer should say, from the live game state. Every
 * disabled state has a reason, so a disabled buzzer never looks broken.
 */
export function buzzerStatus(
  state: PrivateGameState,
  gameUserId: string,
): BuzzerStatus {
  const { game, buzzWinner } = state;
  const self = state.gameUsers[gameUserId];
  const teamId = self?.gameTeamId ?? null;
  const team = state.gameTeams.find((t) => t.id === teamId);

  if (game.status === GameStatus.finished) {
    return {
      canBuzz: false,
      tone: "blocked",
      message: "This game has finished. Thanks for playing!",
    };
  }
  if (!team) {
    if (game.format === GameFormat.individual) {
      return {
        canBuzz: false,
        tone: "blocked",
        message: "You're not set up to buzz yet. Ask your host.",
      };
    }
    return {
      canBuzz: false,
      tone: "blocked",
      message:
        game.teamAssignment === "staff"
          ? "Waiting for your host to put you on a team."
          : "Pick a team to play.",
    };
  }

  const isTeamGame = game.format === GameFormat.team;
  if (game.buzzerMode === "queue") {
    return queueStatus(state, gameUserId, team.id, isTeamGame);
  }
  if (buzzWinner?.gameTeamId === team.id) {
    return {
      canBuzz: false,
      tone: "won",
      message:
        buzzWinner.gameUserId === gameUserId
          ? "You buzzed in first!"
          : "Your team buzzed in first!",
    };
  }
  if (team.buzzerState === BuzzerState.rejected) {
    return {
      canBuzz: false,
      tone: "blocked",
      message: isTeamGame
        ? "Your team already had its turn this round."
        : "You already had your turn this round.",
    };
  }
  if (buzzWinner) {
    const winnerName = buzzWinner.gameUserId
      ? state.gameUsers[buzzWinner.gameUserId]?.name
      : undefined;
    const winnerTeam = state.gameTeams.find(
      (t) => t.id === buzzWinner.gameTeamId,
    )?.name;
    return {
      canBuzz: false,
      tone: "waiting",
      message: `${(isTeamGame ? winnerTeam : winnerName) ?? winnerTeam ?? "Someone"} buzzed in first.`,
    };
  }
  if (game.isBuzzerListening) {
    return { canBuzz: true, tone: "ready", message: "Buzzer open: press now!" };
  }
  return {
    canBuzz: false,
    tone: "waiting",
    message: "Buzzer closed. Wait for the host to open it.",
  };
}

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ??
        "th");
  return `${n}${suffix}`;
};

/** Queue mode: where this player's team is in the queue, if anywhere. */
function queueStatus(
  state: PrivateGameState,
  gameUserId: string,
  teamId: string,
  isTeamGame: boolean,
): BuzzerStatus {
  const { game, buzzQueue } = state;
  const name = (id: string) => state.gameUsers[id]?.name ?? "A teammate";
  const teamName = (id: string) =>
    state.gameTeams.find((t) => t.id === id)?.name ?? "Another team";
  const mine = buzzQueue.filter((e) => e.gameTeamId === teamId);
  const active = mine.find(
    (e) => e.status === "answering" || e.status === "waiting",
  );
  const you = (e: { gameUserId: string }) => e.gameUserId === gameUserId;

  if (mine.some((e) => e.status === "correct")) {
    return { canBuzz: false, tone: "won", message: "Correct! Well done." };
  }
  if (active?.status === "answering") {
    return {
      canBuzz: false,
      tone: "won",
      message: you(active)
        ? "You're answering!"
        : isTeamGame
          ? `Your team is answering (${name(active.gameUserId)} buzzed)!`
          : "You're answering!",
    };
  }
  if (mine.some((e) => e.status === "wrong")) {
    return {
      canBuzz: false,
      tone: "blocked",
      message: isTeamGame
        ? "Not this time: your team sits out until the next question."
        : "Not this time: you sit out until the next question.",
    };
  }
  if (active) {
    const place =
      buzzQueue.filter(
        (e) =>
          (e.status === "answering" || e.status === "waiting") &&
          e.position < active.position,
      ).length + 1;
    const who = you(active) || !isTeamGame ? "You're" : "Your team is";
    const by =
      isTeamGame && !you(active) ? ` (${name(active.gameUserId)} buzzed)` : "";
    return {
      canBuzz: false,
      tone: "waiting",
      message:
        place === 2
          ? `${who} next in line${by}.`
          : `${who} ${ordinal(place)} in line${by}.`,
    };
  }
  const winner = buzzQueue.find((e) => e.status === "correct");
  if (winner) {
    return {
      canBuzz: false,
      tone: "waiting",
      message: `${teamName(winner.gameTeamId)} got it.`,
    };
  }
  if (game.isBuzzerListening) {
    return {
      canBuzz: true,
      tone: "ready",
      message: "Buzzer open: press to join the queue!",
    };
  }
  return {
    canBuzz: false,
    tone: "waiting",
    message: buzzQueue.some((e) => e.status === "answering")
      ? "Buzzer closed: the host is working through the queue."
      : "Buzzer closed. Wait for the host to open it.",
  };
}
