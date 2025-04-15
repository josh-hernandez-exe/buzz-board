"use client";

import { GameFormat, type GameUser } from "@prisma/client";

import { GenericCard } from "@/app/_components/GenericCard";
import { api } from "@/trpc/react";
import type { PublicGameState } from "@/types";

import { logger } from "@/utils/logger";

export function GameUserInfo({
  initialGameUser,
  initialGameState,
}: {
  initialGameUser: Pick<GameUser, "id" | "name" | "gameTeamId">;
  initialGameState: PublicGameState;
}) {
  // TODO: Make this component react to when switch teams
  const gameSelfInfo = api.gameUser.getSelfInfo.useQuery();
  const gameStateSub = api.public.gameState.useSubscription({
    gameId: initialGameState.game.id,
  });

  const currentGameState = gameStateSub.data ?? initialGameState;

  const gameUser = gameSelfInfo.data || initialGameUser;
  const { game, gameTeams } = currentGameState;

  const gameTeam = gameTeams.find(({ id }) => id === gameUser.gameTeamId);

  return (
    <GenericCard
      key={gameUser.id}
      title={gameUser.name}
      content={
        <div>
          <h1 className="mb-4 text-2xl font-bold">
            Welcome to Game {game?.name}
          </h1>
          <p>Game ID: {game?.id}</p>
          <p>
            Game Buzzer Listening State :{" "}
            {game.isBuzzerListening ? "Listening" : "Not Listening"}
          </p>
          {game?.format === GameFormat.team && (
            <p>Number of Teams: {gameTeams.length ?? 0}</p>
          )}
          <p>Player ID: {gameUser.id}</p>
          <p>Player Team ID: {gameUser.gameTeamId}</p>
          {gameTeam && <p>Player Team Name: {gameTeam.name}</p>}
          {gameTeam && <p>Player Team Buzzer State: {gameTeam.buzzerState}</p>}
          {gameTeam && <p>Player Team Score: {gameTeam.score}</p>}
        </div>
      }
    />
  );
}
