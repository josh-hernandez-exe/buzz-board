"use client";

import { api } from "@/trpc/react";

import { GamePublicScoreboardTeamCard } from "@/app/_components/client/GamePublicScoreboardTeamCard";
import { GamePublicInfoCard } from "@/app/_components/client/GamePublicInfoCard";

import type { PublicGameState } from "@/types";

export function PublicScoreboard({
  gameState: initialGameState,
}: {
  gameState: PublicGameState;
}) {
  const gameStateSub = api.public.gameState.useSubscription({
    gameId: initialGameState.game.id,
  });

  const currentGameState = gameStateSub.data ?? initialGameState;

  const { game, gameTeams } = currentGameState;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Welcome to Game {game?.name}</h1>
      <GamePublicInfoCard game={currentGameState.game} />
      {gameTeams.map((gameTeam) => {
        return (
          <GamePublicScoreboardTeamCard
            key={gameTeam.id}
            gameId={game.id}
            gameTeam={gameTeam}
          />
        );
      })}
    </div>
  );
}
