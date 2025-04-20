"use client";

import { GameFormat } from "@prisma/client";

import { GenericCard } from "@/app/_components/GenericCard";
import { api } from "@/trpc/react";
import type { PublicGameState } from "@/types";

import { logger } from "@/utils/logger";

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
      <p>Game ID: {game?.id}</p>
      <p>
        Game Buzzer Listening State :{" "}
        {game.isBuzzerListening ? "Listening" : "Not Listening"}
      </p>
      {game?.format === GameFormat.team && (
        <p>Number of Teams: {gameTeams.length ?? 0}</p>
      )}
      {gameTeams.map((gameTeam) => {
        const content = (
          <div>
            <p>Buzzer: {gameTeam.buzzerState}</p>
            <p> Score: {gameTeam.score} </p>
            <p>Number of Players: {gameTeam.numPlayers ?? 0}</p>
            <p>Team Buzzer State: {gameTeam.buzzerState}</p>
          </div>
        );
        return (
          <GenericCard
            key={gameTeam.id}
            title={gameTeam.name}
            content={content}
          />
        );
      })}
    </div>
  );
}
