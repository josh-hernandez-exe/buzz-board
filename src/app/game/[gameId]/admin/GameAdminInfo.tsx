"use client";

import { api } from "@/trpc/react";

import { GameTeamSummaryCard } from "@/app/_components/client/GameTeamSummaryCard";
import { GameAdminBuzzerControl } from "@/app/_components/client/GameAdminBuzzerControl";
import { GameAdminScoreboardAdvancedControl } from "@/app/_components/client/GameAdminScoreboardAdvancedControl";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";
import { GameBasicInfoCard } from "@/app/_components/client/GameBasicInfoCard";

import { useGameTokenData } from "@/app/_hooks/gameTokenData";

import type { PrivateGameState, BasicGameInfo } from "@/types";

import { logger } from "@/logger";

export function GameAdminInfo({
  gameState: initialGameState,
}: {
  gameState: PrivateGameState;
}) {
  useGameTokenData();
  const gameStateSub = api.gameGeneral.gameState.useSubscription();

  const currentGameState: PrivateGameState =
    gameStateSub.data ?? initialGameState;

  if (!currentGameState) {
    return undefined;
  }

  const { game, gameTeams } = currentGameState;

  return (
    <div>
      <GameBasicInfoCard game={game as BasicGameInfo} />
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
