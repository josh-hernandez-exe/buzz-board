"use client";

import { api } from "@/trpc/react";
import type { PrivateGameState } from "@/types";

import { GameScoreboardTeamCard } from "@/app/_components/client/GameScoreboardTeamCard";
import { GameBasicInfoCard } from "@/app/_components/client/GameBasicInfoCard";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";

export function Scoreboard({
  gameState: initialGameState,
}: {
  gameState: PrivateGameState;
}) {
  const gameStateSub = api.gameGeneral.gameState.useSubscription();

  const currentGameState = gameStateSub.data ?? initialGameState;

  const { game, gameTeams } = currentGameState;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Welcome to Game {game?.name}</h1>
      <GameWhoBuzzedIn />
      <GameBasicInfoCard game={currentGameState.game} />
      {gameTeams.map((gameTeam) => {
        return <GameScoreboardTeamCard key={gameTeam.id} gameTeam={gameTeam} />;
      })}
    </div>
  );
}
