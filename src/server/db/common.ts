import type { Game, GameTeam } from "@prisma/client";
import { db } from "@/server/db";
import { ok, err, Result } from "neverthrow";

import type { PublicGameState, PrivateGameState } from "@/types";
import { gameEventEmitter } from "@/utils/events";

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

  const scoreboardState = game.scoreboard?.currentState?.state as Record<
    GameTeam["id"],
    number
  >;

  const data: PublicGameState = {
    game: {
      id: game.id,
      name: game.name,
      format: game.format,
      isBuzzerListening: game.isBuzzerListening,
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
      gameTeams: {
        select: {
          id: true,
          name: true,
          index: true,
          buzzerState: true,
          gameUsers: {
            select: {
              id: true,
              name: true,
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

  const scoreboardState = game.scoreboard?.currentState?.state as Record<
    GameTeam["id"],
    number
  >;

  const data: PrivateGameState = {
    game: {
      id: game.id,
      name: game.name,
      code: game.code,
      format: game.format,
      isBuzzerListening: game.isBuzzerListening,
    },
    gameTeams: game.gameTeams.map((gameTeam) => ({
      id: gameTeam.id,
      name: gameTeam.name,
      index: gameTeam.index,
      buzzerState: gameTeam.buzzerState,
      gameUsers: gameTeam.gameUsers.map((gameUser) => ({
        id: gameUser.id,
        name: gameUser.name,
      })),
      score: scoreboardState[gameTeam.id] ?? 0,
    })),
  };

  data.gameTeams.sort((a, b) => a.index - b.index);
  data.gameTeams.map((gameTeam) => {
    gameTeam.gameUsers.sort((a, b) => a.name.localeCompare(b.name));
  });

  return ok(data);
}

export async function emitUpdatedGameState({
  gameId,
}: {
  gameId: Game["id"];
}): Promise<Result<void, Error>> {
  const [publicResult, privateResult] = await Promise.all([
    getPublicGameState({ gameId }),
    getPrivateGameState({ gameId }),
  ]);

  if (publicResult.isErr()) {
    return err(publicResult.error);
  }
  if (privateResult.isErr()) {
    return err(privateResult.error);
  }

  gameEventEmitter.emit("publicGameStateUpdate", gameId, publicResult.value);
  gameEventEmitter.emit("privateGameStateUpdate", gameId, privateResult.value);

  return ok();
}

export async function checkTeamsAndGetCurrentScores({
  gameId,
  gameTeamIds,
}: {
  gameId: Game["id"];
  gameTeamIds: GameTeam["id"][];
}) {
  const gameTeams = await db.gameTeam.findMany({
    where: {
      gameId,
      id: {
        in: gameTeamIds,
      },
    },
  });

  if (gameTeams.length !== gameTeamIds.length) {
    return err(new Error("Game teams not found"));
  }

  const scoreboard = await db.scoreboard.findUnique({
    where: {
      gameId,
    },
    include: {
      currentState: true,
    },
  });

  if (!scoreboard) {
    return err(new Error("Scoreboard not found"));
  }
  if (!scoreboard.currentState) {
    return err(new Error("Scoreboard does not have a current state"));
  }

  const oldScoreboardState = scoreboard?.currentState;

  const currentScores: { [key: GameTeam["id"]]: number } =
    (oldScoreboardState?.state as { [key: GameTeam["id"]]: number }) ?? {};

  return ok({
    scoreboard,
    currentScores,
  });
}
