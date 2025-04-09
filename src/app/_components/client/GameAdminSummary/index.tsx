"use client";

import {
  type GameTeam,
  type GameUser,
  type ScoreboardState,
} from "@prisma/client";

// import { GameTeamSummaryCard } from "@/app/_components/client/GameTeamSummaryCard";

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
      score: (scoreboardState?.state as ScoreboardStateJson)[gameTeam.id],
    };
  });

  return data;
}

export function GameAdminSummary({ game }: { game: GameWithRelations }) {
  if (game === undefined) {
    logger.error("GameAdminSummary has an undefined game");
    return undefined;
  }

  logger.debug(`GameAdminSummary: $${game.id}`);

  const { scoreboard } = game;
  const currScoreboardStateId = scoreboard?.currentStateId;
  const currScoreboardState = game?.scoreboardStates?.filter(
    (scoreboardState) => {
      return scoreboardState.scoreboardId === currScoreboardStateId;
    },
  )?.[0];

  const data = groupDataByTeam({ game, scoreboardState: currScoreboardState });

  return (
    <div>
      <p>Game ID: {game.id}</p>
      <p>Game Name: {game.name}</p>
      <p>Buzzer Listening: {game.isBuzzerListening}</p>
      {Object.values(data).map((gameTeamData: GameRelationInfo) => {
        // return <GameTeamSummaryCard {...gameTeamData} />;
        return undefined;
      })}
    </div>
  );
}
