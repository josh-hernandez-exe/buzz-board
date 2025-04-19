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

import { GameTeamUserTable } from "./GameTeamUserTable";

export function GameTeamInfoCard() {
  const gameTeamInfo = api.gameUser.getSelfTeamInfo.useQuery(undefined, {
    staleTime: 10_000,
  });

  if (gameTeamInfo.isLoading) {
    return <div>Loading...</div>;
  }

  gameTeamInfo.data!.gameUsers.sort((a, b) => a.index - b.index);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Info</CardTitle>
        <CardDescription>Team related information</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Team Name: {gameTeamInfo.data?.name}</p>
        <p>Team Index Number: {gameTeamInfo.data?.index}</p>
        <p>Team Id: {gameTeamInfo.data?.id}</p>
        <GameUserEditSheet />
        <p>Number of Players on Team: {gameTeamInfo.data?.gameUsers.length}</p>
        <GameTeamUserTable
          data={gameTeamInfo.data!.gameUsers.map((gameUser) => ({
            id: gameUser.id,
            name: gameUser.name,
            index: gameUser.index,
            image: gameUser?.user?.image,
          }))}
        />
      </CardContent>
      <CardFooter></CardFooter>
    </Card>
  );
}
