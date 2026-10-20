import type { Game } from "@prisma/client";
import { db } from "@/server/db";
import type { Result } from "neverthrow";

import { parseScoreMap } from "@/server/scores/scoreMath";
import { getBuzzWinner } from "@/server/buzzer/buzzerService";
import { err, ok } from "neverthrow";

import type { PublicGameState, PrivateGameState, GameSettings } from "@/types";

export async function getPublicGameState({
  gameId,
}: {
  gameId: Game["id"];
}): Promise<Result<PublicGameState, Error>> {
  const game = await db.game.findUnique({
    select: {
      id: true,
      name: true,
      format: true,
      isBuzzerListening: true,
      status: true,
      gameTeams: {
        select: {
          id: true,
          name: true,
          index: true,
          buzzerState: true,
          _count: {
            select: {
              gameUsers: true,
            },
          },
        },
      },
      scoreboard: {
        select: {
          currentState: {
            select: {
              state: true,
            },
          },
        },
      },
    },
    where: {
      id: gameId,
    },
  });

  if (!game) {
    return err(new Error("Game not found"));
  }

  const scoreboardState = parseScoreMap(game.scoreboard?.currentState?.state);

  const data: PublicGameState = {
    game: {
      id: game.id,
      name: game.name,
      format: game.format,
      isBuzzerListening: game.isBuzzerListening,
      status: game.status,
    },
    gameTeams: game.gameTeams.map((gameTeam) => ({
      id: gameTeam.id,
      name: gameTeam.name,
      index: gameTeam.index,
      buzzerState: gameTeam.buzzerState,
      numPlayers: gameTeam._count.gameUsers,
      score: scoreboardState[gameTeam.id] ?? 0,
    })),
  };

  data.gameTeams.sort((a, b) => a.index - b.index);

  return ok(data);
}

export async function getPrivateGameState({ gameId }: { gameId: Game["id"] }) {
  const game = await db.game.findUnique({
    select: {
      id: true,
      name: true,
      format: true,
      code: true,
      isBuzzerListening: true,
      settings: true,
      status: true,
      finishedAt: true,
      joiningOpen: true,
      teamAssignment: true,
      gameTeams: {
        select: {
          id: true,
          name: true,
          index: true,
          buzzerState: true,
          gameUsers: {
            select: {
              id: true,
            },
          },
        },
      },
      gameUsers: {
        select: {
          id: true,
          name: true,
          index: true,
          gameTeamId: true,
          user: {
            select: {
              id: true,
              image: true,
            },
          },
        },
      },
      scoreboard: {
        select: {
          currentState: {
            select: {
              state: true,
            },
          },
        },
      },
    },
    where: {
      id: gameId,
    },
  });

  if (!game) {
    return err(new Error("Game not found"));
  }

  const scoreboardState = parseScoreMap(game.scoreboard?.currentState?.state);

  const buzzWinner = await getBuzzWinner(gameId);

  const data: PrivateGameState = {
    buzzWinner,
    game: {
      id: game.id,
      name: game.name,
      code: game.code,
      format: game.format,
      isBuzzerListening: game.isBuzzerListening,
      settings: game.settings as GameSettings,
      status: game.status,
      finishedAt: game.finishedAt,
      joiningOpen: game.joiningOpen,
      teamAssignment: game.teamAssignment,
    },
    gameTeams: game.gameTeams.map((gameTeam) => ({
      id: gameTeam.id,
      name: gameTeam.name,
      index: gameTeam.index,
      buzzerState: gameTeam.buzzerState,
      gameUsers: gameTeam.gameUsers.map((gameUser) => gameUser.id),
      score: scoreboardState[gameTeam.id] ?? 0,
    })),
    gameUsers: game.gameUsers.reduce(
      (acc, gameUser) => {
        acc[gameUser.id] = {
          id: gameUser.id,
          name: gameUser.name,
          index: gameUser.index,
          gameTeamId: gameUser.gameTeamId,
          image: gameUser.user?.image,
        };
        return acc;
      },
      {} as PrivateGameState["gameUsers"],
    ),
  };

  data.gameTeams.sort((a, b) => a.index - b.index);
  data.gameTeams.forEach((gameTeam) => {
    gameTeam.gameUsers.sort((a, b) => {
      const userA = data.gameUsers[a];
      const userB = data.gameUsers[b];

      if (!userA || !userB) {
        return 0;
      }

      return userA.name.localeCompare(userB.name);
    });
  });

  return ok(data);
}
