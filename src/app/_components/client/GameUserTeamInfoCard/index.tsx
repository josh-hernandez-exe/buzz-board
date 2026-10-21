"use client";

import { env } from "@/env";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/app/_components/ui/card";

import { api } from "@/trpc/react";

import type {
  GameUserFromPrivateState,
  GameTeamFromPrivateState,
  GameUserFromTeamWithRelations,
} from "@/types";

import { GameTeamUserTable } from "./GameTeamUserTable";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";

export function GameUserTeamInfoCard({
  gameTeam: initialGameTeam,
  gameUsers: initialGameUsers,
}: {
  gameTeam?: GameTeamFromPrivateState;
  gameUsers?: GameUserFromPrivateState[];
}) {
  const gameTeamInfo = api.gameUser.getSelfTeamInfo.useQuery();
  const gameState = useLiveGameState();

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
        <div className="border-destructive/40 bg-destructive-soft rounded-lg border p-6 text-center">
          <h3 className="text-destructive mb-2 text-lg font-medium">
            No team assigned
          </h3>
          <p className="text-destructive">
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
        <CardTitle>Your team</CardTitle>
        <CardDescription>Who you&apos;re playing with</CardDescription>
      </CardHeader>
      <CardContent>
        <p>
          {gameTeam?.name} (team {gameTeam?.index}) · {gameUsers.length}{" "}
          {gameUsers.length === 1 ? "player" : "players"}
        </p>
        {env.NEXT_PUBLIC_SHOW_DEBUG_INFO && <p>Team ID: {gameTeam?.id}</p>}
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
