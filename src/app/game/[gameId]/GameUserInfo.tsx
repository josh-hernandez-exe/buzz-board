"use client";

import { GameFormat } from "@prisma/client";

import { GenericCard } from "@/app/_components/GenericCard";
import { GameUserEditSheet } from "@/app/_components/client/GameUserEditSheet";
import { api } from "@/trpc/react";
import type { PublicGameState, GameUserWithRelations } from "@/types";

import { logger } from "@/utils/logger";

export function GameUserInfo({
  initialGameUser,
  initialGameState,
}: {
  initialGameUser: GameUserWithRelations;
  initialGameState: PublicGameState;
}) {
  const utils = api.useUtils();

  const gameSelfInfo = api.gameUser.getSelfInfo.useQuery();

  const gameStateSub = api.public.gameState.useSubscription({
    gameId: initialGameUser.gameId,
  });

  const currentGameState = gameStateSub.data ?? initialGameState;

  const gameUser = gameSelfInfo.data || initialGameUser;
  const { game, gameTeams } = currentGameState;

  const gameTeam = gameTeams.find((team) => team.id === gameUser.gameTeamId);

  return (
    <GenericCard
      key={gameUser.id}
      title={
        <div>
          <GameUserEditSheet />
          <p> Player Name: {gameUser.name} </p>
          <br></br>
          {game.format === GameFormat.team && (
            <p> Team Name: {gameTeam?.name} </p>
          )}
        </div>
      }
      content={
        <div>
          <p>Game ID: {game?.id}</p>
          <p>Game Name: {game?.name}</p>
          <p>
            Game Buzzer Listening State :{" "}
            {game.isBuzzerListening ? "Listening" : "Not Listening"}
          </p>
          <p>Player No: {gameUser.index}</p>
          {gameUser.gameTeam && (
            <div>
              {game.format === GameFormat.team && (
                <div>
                  <p>Player Team Name: {gameUser.gameTeam.name}</p>
                  <p>Player Team No: {gameUser.gameTeam.index}</p>
                </div>
              )}
              <p>Player Team Buzzer State: {gameTeam?.buzzerState}</p>
              <p>Player Team Score: {gameTeam?.score}</p>
            </div>
          )}
        </div>
      }
    />
  );
}
