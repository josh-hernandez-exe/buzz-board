import type { Game } from "@prisma/client";
import { db } from "@/server/db";
import type { Result } from "neverthrow";

import { parseScoreMap } from "@/server/scores/scoreMath";
import { getBuzzQueue, getBuzzWinner } from "@/server/buzzer/buzzerService";
import { publicGameModeView } from "@/utils/modes";
import { bankSchema } from "@/utils/categoryGrid/content";
import { questionKey, type QuizState } from "@/utils/sequentialQuiz/engine";
import { type AnswerProgress } from "@/utils/sequentialQuiz/projection";
import { err, ok } from "neverthrow";

import type { PublicGameState, PrivateGameState, GameSettings } from "@/types";

/** The game no longer exists (for example its owner deleted it). */
export class GameNotFoundError extends Error {
  constructor(readonly gameId: string) {
    super("Game not found");
  }
}

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
      buzzerMode: true,
      status: true,
      code: true,
      joiningOpen: true,
      gameMode: {
        select: {
          kind: true,
          status: true,
          content: true,
          state: true,
          step: true,
        },
      },
      gameTeams: {
        select: {
          id: true,
          name: true,
          index: true,
          buzzerState: true,
          _count: {
            select: {
              gameUsers: { where: { removedAt: null } },
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
    return err(new GameNotFoundError(gameId));
  }

  const scoreboardState = parseScoreMap(game.scoreboard?.currentState?.state);

  const data: PublicGameState = {
    game: {
      id: game.id,
      name: game.name,
      format: game.format,
      isBuzzerListening: game.isBuzzerListening,
      buzzerMode: game.buzzerMode,
      status: game.status,
      joinCode:
        game.joiningOpen && game.status !== "finished" ? game.code : null,
    },
    gameTeams: game.gameTeams.map((gameTeam) => ({
      id: gameTeam.id,
      name: gameTeam.name,
      index: gameTeam.index,
      buzzerState: gameTeam.buzzerState,
      numPlayers: gameTeam._count.gameUsers,
      score: scoreboardState[gameTeam.id] ?? 0,
    })),
    buzzQueue: (await getBuzzQueue(gameId)).map((e) => ({
      position: e.position,
      gameTeamId: e.gameTeamId,
      status: e.status,
    })),
    mode: publicGameModeView(
      game.gameMode,
      await answeredTeams(gameId, game.gameMode),
    ),
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
      buzzerMode: true,
      settings: true,
      status: true,
      finishedAt: true,
      joiningOpen: true,
      gameMode: {
        select: {
          kind: true,
          status: true,
          content: true,
          state: true,
          step: true,
        },
      },
      teamAssignment: true,
      chatEnabled: true,
      gameTeams: {
        select: {
          id: true,
          name: true,
          index: true,
          buzzerState: true,
          allowMemberRename: true,
          nameVersion: true,
          gameUsers: {
            where: { removedAt: null },
            select: {
              id: true,
            },
          },
        },
      },
      gameUsers: {
        where: { removedAt: null },
        select: {
          id: true,
          name: true,
          index: true,
          gameTeamId: true,
          allowSelfRename: true,
          nameVersion: true,
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
    return err(new GameNotFoundError(gameId));
  }

  const scoreboardState = parseScoreMap(game.scoreboard?.currentState?.state);

  const buzzWinner = await getBuzzWinner(gameId);

  const data: PrivateGameState = {
    buzzWinner,
    buzzQueue: await getBuzzQueue(gameId),
    mode: publicGameModeView(
      game.gameMode,
      await answeredTeams(gameId, game.gameMode),
    ),
    game: {
      id: game.id,
      name: game.name,
      code: game.code,
      format: game.format,
      isBuzzerListening: game.isBuzzerListening,
      buzzerMode: game.buzzerMode,
      settings: game.settings as GameSettings,
      status: game.status,
      finishedAt: game.finishedAt,
      joiningOpen: game.joiningOpen,
      teamAssignment: game.teamAssignment,
      chatEnabled: game.chatEnabled,
    },
    gameTeams: game.gameTeams.map((gameTeam) => ({
      id: gameTeam.id,
      name: gameTeam.name,
      index: gameTeam.index,
      buzzerState: gameTeam.buzzerState,
      allowMemberRename: gameTeam.allowMemberRename,
      nameVersion: gameTeam.nameVersion,
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
          allowSelfRename: gameUser.allowSelfRename,
          nameVersion: gameUser.nameVersion,
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

/**
 * Sequential Quiz: the teams that have saved an answer to the open
 * question (only which teams, never what they typed).
 */
async function answeredTeams(
  gameId: string,
  mode: {
    kind: string;
    status: string;
    content: unknown;
    state: unknown;
  } | null,
): Promise<AnswerProgress | undefined> {
  if (mode?.kind !== "sequentialQuiz" || mode.status !== "running") {
    return undefined;
  }
  const bank = bankSchema.safeParse(mode.content);
  const state = mode.state as QuizState | null;
  if (!bank.success || !state) return undefined;
  return answerProgress(gameId, questionKey(bank.data, state));
}

/** Which teams answered the question with this key; see `AnswerProgress`. */
export async function answerProgress(
  gameId: string,
  key: string | null,
): Promise<AnswerProgress> {
  if (!key) return { teams: [], version: 0 };
  const rows = await db.teamAnswer.findMany({
    where: { gameId, questionKey: key },
    select: { gameTeamId: true, revision: true },
  });
  return {
    teams: rows.map((r) => r.gameTeamId),
    version: rows.reduce((sum, r) => sum + r.revision, 0),
  };
}
