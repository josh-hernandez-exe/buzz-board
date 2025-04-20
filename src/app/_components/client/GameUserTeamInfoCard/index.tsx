"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/app/_components/ui/card";

import { GameUserEditSheet } from "@/app/_components/client/GameUserEditSheet";
import { api } from "@/trpc/react";

import { logger } from "@/utils/logger";
import type { GameTeamWithRelations, GameTeamFromPrivateState } from "@/types";

import { GameTeamUserTable } from "./GameTeamUserTable";

export function GameUserTeamInfoCard({
  gameTeam: initialGameTeam,
}: {
  gameTeam?: GameTeamFromPrivateState | undefined;
}) {
  const gameTeamInfo = api.gameUser.getSelfTeamInfo.useQuery();
  const gameState = api.gameGeneral.gameState.useSubscription();

  const GameTeamFromPrivateState: GameTeamFromPrivateState | undefined =
    gameState?.data?.gameTeams.find(
      (team) => team.id === gameTeamInfo.data?.id,
    );

  const gameTeam =
    GameTeamFromPrivateState || gameTeamInfo.data || initialGameTeam;

  if (!gameTeam) {
    return <div>Loading...</div>;
  }

  gameTeam.gameUsers.sort((a, b) => a.index - b.index);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Info</CardTitle>
        <CardDescription>Team related information</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Team Name: {gameTeam?.name}</p>
        <p>Team Index Number: {gameTeam?.index}</p>
        <p>Team Id: {gameTeam?.id}</p>
        <GameUserEditSheet />
        <p>Number of Players on Team: {gameTeam?.gameUsers.length}</p>
        <GameTeamUserTable
          data={gameTeam.gameUsers.map((gameUser) => {
            const imageFromRelation = (
              gameUser as GameTeamWithRelations["gameUsers"][number]
            ).user?.image;
            const imageFromGameState = (
              gameUser as GameTeamFromPrivateState["gameUsers"][number]
            ).image;
            const image = imageFromRelation || imageFromGameState;
            return {
              id: gameUser.id,
              name: gameUser.name,
              index: gameUser.index,
              image,
            };
          })}
        />
      </CardContent>
      <CardFooter></CardFooter>
    </Card>
  );
}
