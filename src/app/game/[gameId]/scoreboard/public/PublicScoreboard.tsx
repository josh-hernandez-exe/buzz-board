"use client";

import { GamePublicScoreboardTeamCard } from "@/app/_components/client/GamePublicScoreboardTeamCard";
import { GamePublicInfoCard } from "@/app/_components/client/GamePublicInfoCard";
import { PublicGameSoundEffects } from "@/app/_components/client/GameSoundEffects";
import {
  PublicLiveGameStateProvider,
  usePublicLiveGameState,
} from "@/app/_components/client/LiveGameState";

import type { PublicGameState } from "@/types";

export function PublicScoreboard({
  gameState: initialGameState,
}: {
  gameState: PublicGameState;
}) {
  return (
    <PublicLiveGameStateProvider
      gameId={initialGameState.game.id}
      initialState={initialGameState}
    >
      <PublicScoreboardContent initialGameState={initialGameState} />
    </PublicLiveGameStateProvider>
  );
}

function PublicScoreboardContent({
  initialGameState,
}: {
  initialGameState: PublicGameState;
}) {
  const currentGameState = usePublicLiveGameState().data ?? initialGameState;

  const { game, gameTeams } = currentGameState;

  return (
    <div>
      {/* Game sound effects for all teams */}
      <PublicGameSoundEffects />

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
