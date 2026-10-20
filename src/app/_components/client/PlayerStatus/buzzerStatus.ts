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
