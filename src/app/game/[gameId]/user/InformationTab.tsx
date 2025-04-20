"use client";

import { GameFormat, type Game } from "@prisma/client";

import { GameUserInfoCard } from "@/app/_components/client/GameUserInfoCard";
import { GameUserTeamInfoCard } from "@/app/_components/client/GameUserTeamInfoCard";
import { GameBasicInfoCard } from "@/app/_components/client/GameBasicInfoCard";

import type {
  PrivateGameState,
  GameUserWithRelations,
  GameTeamFromPrivateState,
} from "@/types";

export function InformationTab({
  gameState,
  gameUser,
}: {
  gameState: PrivateGameState;
  gameUser: GameUserWithRelations;
}) {
  const initialGameTeam = gameState.gameTeams.find(
    (team) => team.id === gameUser.gameTeamId,
  ) as GameTeamFromPrivateState | undefined;

  return (
    <div className="flex flex-col items-center justify-center">
      <GameBasicInfoCard game={gameState.game} />
      <GameUserInfoCard gameUser={gameUser} />
      {gameState.game.format === GameFormat.team && (
        <GameUserTeamInfoCard gameTeam={initialGameTeam} />
      )}
    </div>
  );
}
