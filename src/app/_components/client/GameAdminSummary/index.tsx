"use client";

import {
  Prisma,
  GameFormat,
  type Game,
  type GameTeam,
  type GameUser,
  type ScoreboardState,
} from "@prisma/client";

import { api } from "@/trpc/react";
import { GameAdminScoreboardControl } from "@/app/_components/client/GameAdminScoreboardControl";
import { GameTeamSummaryCard } from "@/app/_components/client/GameTeamSummaryCard";
import { GameAdminBuzzerControl } from "@/app/_components/client/GameAdminBuzzerControl";
import { Button } from "@/app/_components/ui/button";

import { logger } from "@/utils/logger";
import type { GameWithRelations } from "@/types";

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
    const score =
      ((scoreboardState?.state as Prisma.JsonObject)?.[gameTeam.id] as
        | number
        | undefined) ?? 0;

    data[gameTeam.id] = {
      gameTeam: gameTeam,
      gameUsers: game.gameUsers.filter(
        (gameUser) => gameUser.gameTeamId === gameTeam.id,
      ),
      score,
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

  const currScoreboardState = game?.scoreboardStates?.find(
    (scoreboardState) => {
      return scoreboardState.id === game?.scoreboard?.currentStateId;
    },
  );

  const data = groupDataByTeam({ game, scoreboardState: currScoreboardState });

  return (
    <div>
      <p>Game ID: {game.id}</p>
      <p>Game Name: {game.name}</p>
      <p>Game Format: {game.format}</p>
      <p>Game Code: {game.code}</p>
      <p>
        Game Buzzer Listening State :{" "}
        {game.isBuzzerListening ? "Listening" : "Not Listening"}
      </p>
      {game.format === GameFormat.team && (
        <p>Number of Teams: {game.gameTeams?.length ?? 0}</p>
      )}
      <p>Number of Players: {game.gameUsers?.length ?? 0}</p>
      <GameAdminBuzzerControl />
      <GameAdminScoreboardControl
        gameTeams={Object.values(data).map(({ gameTeam }) => gameTeam)}
      />
      {Object.values(data).map(
        ({ gameTeam, gameUsers, score }: GameRelationInfo) => {
          // return undefined;
          return (
            <GameTeamSummaryCard
              key={gameTeam.id}
              gameTeam={gameTeam}
              gameUsers={gameUsers}
              score={score}
            />
          );
        },
      )}
    </div>
  );
}
