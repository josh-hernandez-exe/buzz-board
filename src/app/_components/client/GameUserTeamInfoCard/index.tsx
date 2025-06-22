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

import type {
  GameUserFromPrivateState,
  GameTeamFromPrivateState,
  GameUserFromTeamWithRelations,
} from "@/types";

import { GameTeamUserTable } from "./GameTeamUserTable";

export function GameUserTeamInfoCard({
  gameTeam: initialGameTeam,
  gameUsers: initialGameUsers,
}: {
  gameTeam?: GameTeamFromPrivateState;
  gameUsers?: GameUserFromPrivateState[];
}) {
  const gameTeamInfo = api.gameUser.getSelfTeamInfo.useQuery();
  const gameState = api.gameGeneral.gameState.useSubscription();

  const gameTeamFromState = gameState.data?.gameTeams.find(
    (team) => team.id === gameTeamInfo.data?.id,
  );

  const gameTeam = gameTeamFromState ?? initialGameTeam;

  let gameUsers: (GameUserFromPrivateState | GameUserFromTeamWithRelations)[] =
    [];

  if (gameTeamFromState && gameState.data) {
    gameUsers = gameTeamFromState.gameUsers
      .map((userId) => gameState?.data?.gameUsers[userId])
      .filter(Boolean) as GameUserFromPrivateState[];
  } else if (gameTeamInfo.data) {
    gameUsers = gameTeamInfo.data.gameUsers;
  } else if (initialGameUsers) {
    gameUsers = initialGameUsers;
  }

  if (
    !gameTeam &&
    (gameTeamInfo.isLoading || gameState.status === "connecting")
  ) {
    // If both the query and subscription data are not available, we show a loading state.
    return <div>Loading...</div>;
  } else if (!gameTeam) {
    // If no team is assigned, we show a message indicating that the user is not part of any team.
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <div className="rounded-lg border border-red-500 bg-red-50 p-6 text-center">
          <h3 className="mb-2 text-lg font-medium text-red-800">
            No team assigned
          </h3>
          <p className="text-red-700">
            You are not currently assigned to any team. Please switch to the
            Team Switcher tab to select your team.
          </p>
        </div>
      </div>
    );
  }

  gameUsers.sort((a, b) => a.index - b.index);

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
        <p>Number of Players on Team: {gameUsers.length}</p>
        <GameTeamUserTable
          data={gameUsers.map((gameUser) => {
            const image =
              "user" in gameUser ? gameUser.user?.image : gameUser.image;
            return {
              id: gameUser.id,
              name: gameUser.name,
              index: gameUser.index,
              image: image ?? null,
            };
          })}
        />
      </CardContent>
      <CardFooter></CardFooter>
    </Card>
  );
}
