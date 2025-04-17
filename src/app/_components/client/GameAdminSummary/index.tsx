"use client";

import { GameFormat, type Game } from "@prisma/client";

import { api } from "@/trpc/react";
import { GameTeamSummaryCard } from "@/app/_components/client/GameTeamSummaryCard";
import { GameAdminBuzzerControl } from "@/app/_components/client/GameAdminBuzzerControl";
import { GameAdminScoreboardAdvancedControl } from "@/app/_components/client/GameAdminScoreboardAdvancedControl";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";
import { useGameIdData } from "@/app/_hooks/gameTokenData";

import { logger } from "@/utils/logger";

export function GameAdminSummary({ gameId }: { gameId: Game["id"] }) {
  if (gameId === undefined) {
    logger.error("GameAdminSummary has an undefined game");
    return undefined;
  }
  logger.debug(`GameAdminSummary: ${gameId}`);

  useGameIdData();

  const gameStateSub = api.gameGeneral.gameState.useSubscription();

  if (!gameStateSub.data) {
    return undefined;
  }

  const { game, gameTeams } = gameStateSub.data;

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
        <p>Number of Teams: {gameTeams.length ?? 0}</p>
      )}
      <p>Number of Players: {gameTeams.length ?? 0}</p>
      <GameWhoBuzzedIn />
      <GameAdminBuzzerControl />
      <GameAdminScoreboardAdvancedControl
        gameTeams={gameTeams.map(({ gameUsers, ...gameTeam }) => gameTeam)}
      />
      {gameTeams.map(({ gameUsers, score, ...gameTeam }) => {
        // return undefined;
        return (
          <GameTeamSummaryCard
            key={gameTeam.id}
            gameTeam={gameTeam}
            gameUsers={gameUsers}
            score={score}
          />
        );
      })}
    </div>
  );
}
