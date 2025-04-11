"use client";

import {
  GameFormat,
  type Game,
  type GameTeam,
  type GameUser,
  type ScoreboardState,
} from "@prisma/client";

import { api, updateExtraHeaders } from "@/trpc/react";
import { GameTeamSummaryCard } from "@/app/_components/client/GameTeamSummaryCard";

import { logger } from "@/utils/logger";
import type { GameWithRelations } from "@/types";

type ScoreboardStateJson = { [key: string]: number };

type GameRelationInfo = {
  gameTeam: GameTeam;
  gameUsers: GameUser[];
  score: number | undefined;
};

type GameTeamInfoMap = { [key: string]: GameRelationInfo };

function groupDataByTeam({
  game,
  scoreboardState,
}: {
  game: GameWithRelations;
  scoreboardState: ScoreboardState | undefined;
}): GameTeamInfoMap {
  const data: GameTeamInfoMap = {};

  // a brand new game may not have any members
  game.gameTeams?.map((gameTeam) => {
    data[gameTeam.id] = {
      gameTeam: gameTeam,
      gameUsers: game.gameUsers.filter(
        (gameUser) => gameUser.gameTeamId === gameTeam.id,
      ),
      score: (scoreboardState?.state as ScoreboardStateJson)?.[gameTeam.id],
    };
  });

  return data;
}

export function GameAdminSummary({ gameId }: { gameId: Game["id"] }) {
  if (gameId === undefined) {
    logger.error("GameAdminSummary has an undefined game");
    return undefined;
  }

  logger.debug(`GameAdminSummary: ${gameId}`);

  const infoQuery = api.gameAdmin.getAllInfo.useQuery();

  if (infoQuery.isLoading) {
    return undefined;
  }

  const game = infoQuery.data as GameWithRelations;

  const { scoreboard } = game;
  const currScoreboardState = game?.scoreboardStates?.filter(
    (scoreboardState) => {
      return scoreboardState.id === scoreboard?.currentStateId;
    },
  )?.[0];

  const data = groupDataByTeam({ game, scoreboardState: currScoreboardState });

  return (
    <div>
      <p>Game ID: {game.id}</p>
      <p>Game Name: {game.name}</p>
      <p>Game Format: {game.format}</p>
      <p>Game Code: {game.code}</p>
      {game.format === GameFormat.team && (
        <p>Number of Teams: {game.gameTeams?.length || 0}</p>
      )}
      <p>Buzzer : {game.isBuzzerListening ? "Listening" : "Not Listening"}</p>
      {Object.values(data).map(
        ({ gameTeam, gameUsers, score }: GameRelationInfo) => {
          // return undefined;
          return (
            <GameTeamSummaryCard
              gameTeam={gameTeam}
              gameUsers={gameUsers}
              buzzerState={gameTeam.buzzerState}
              score={score}
            />
          );
        },
      )}
    </div>
  );
}
