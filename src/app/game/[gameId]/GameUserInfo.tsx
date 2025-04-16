"use client";

import { useState } from "react";
import { GameFormat, type GameUser } from "@prisma/client";
import { InlineEdit } from "rsuite";

import { GenericCard } from "@/app/_components/GenericCard";
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
  // TODO: Make this component react to when switch teams
  const utils = api.useUtils();
  const [gameUserName, setGameUserName] = useState(initialGameUser.name);
  const [gameTeamName, setGameTeamName] = useState(
    initialGameUser.gameTeam?.name,
  );

  const gameSelfInfo = api.gameUser.getSelfInfo.useQuery();
  const changeNameMutation = api.gameUser.changeName.useMutation({
    onSuccess: async () => {
      utils.gameUser.getSelfInfo.invalidate();
    },
    onError: async () => {
      setGameUserName(gameUser.name);
    },
  });
  const changeTeamNameMutation = api.gameUser.changeTeamName.useMutation({
    onSuccess: async () => {
      utils.gameUser.getSelfInfo.invalidate();
    },
    onError: async () => {
      setGameTeamName(gameTeam?.name);
    },
  });
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
          <p>Player Name</p>
          <InlineEdit
            value={gameUserName}
            style={{ width: 500 }}
            onCancel={() => {
              setGameUserName(gameUser.name);
            }}
            onChange={(val, e) => {
              setGameUserName(val);
            }}
            onSave={(e) => {
              changeNameMutation.mutate({ name: gameUserName });
            }}
            disabled={changeNameMutation.isPending}
          />
          <br></br>
          {game.format === GameFormat.team && (
            // NOTE: Only show this component when the game format is team
            <>
              <p>Team Name</p>
              <InlineEdit
                value={gameTeamName}
                style={{ width: 500 }}
                onCancel={() => {
                  setGameTeamName(gameTeam?.name);
                }}
                onChange={(val, e) => {
                  setGameTeamName(val);
                }}
                onSave={(e) => {
                  if (gameTeamName) {
                    changeTeamNameMutation.mutate({ name: gameTeamName });
                  }
                }}
                disabled={changeTeamNameMutation.isPending}
              />
            </>
          )}
        </div>
      }
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
          <p>Player ID: {gameUser.id}</p>
          <p>Player Team ID: {gameUser.gameTeamId}</p>
          {gameUser.gameTeam && (
            <p>Player Team Name: {gameUser.gameTeam.name}</p>
          )}
          {gameTeam && <p>Player Team Buzzer State: {gameTeam.buzzerState}</p>}
          {gameTeam && <p>Player Team Score: {gameTeam.score}</p>}
        </div>
      }
    />
  );
}
