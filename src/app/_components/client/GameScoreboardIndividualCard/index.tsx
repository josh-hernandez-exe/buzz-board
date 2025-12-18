"use client";

import { BuzzerState } from "@prisma/client";
import { X } from "lucide-react";

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
  GameTeamFromPrivateState,
  GameUserFromPrivateState,
} from "@/types";

import { cn } from "@/app/_lib/utils";

export function GameScoreboardIndividualCard({
  gameTeam: initialGameTeam,
  gameUser: initialGameUser,
}: {
  gameTeam: GameTeamFromPrivateState;
  gameUser: GameUserFromPrivateState;
}) {
  const { id: gameTeamId } = initialGameTeam;
  const gameState = api.gameGeneral.gameState.useSubscription();

  const gameTeamFromState: GameTeamFromPrivateState | undefined =
    gameState?.data?.gameTeams.find((team) => team.id === gameTeamId);

  const gameTeam = gameTeamFromState ?? initialGameTeam;

  const gameUserFromState =
    gameState?.data?.gameUsers[initialGameUser.id] ?? initialGameUser;

  const gameUser = gameUserFromState;

  if (!gameTeam || !gameUser) {
    return <div>Loading...</div>;
  }

  const cardColor = cn({
    "bg-white": gameTeam.buzzerState === BuzzerState.available,
    "bg-green-500 text-white": gameTeam.buzzerState === BuzzerState.selected,
    "bg-red-500 text-white": gameTeam.buzzerState === BuzzerState.rejected,
  });

  const icon =
    gameTeam.buzzerState === BuzzerState.rejected ? (
      <X className="absolute inset-0 h-full w-full text-white opacity-30" />
    ) : null;

  return (
    <Card className={cn(cardColor, "relative")}>
      {icon}
      <CardHeader>
        <CardTitle>
          <div className="h-14 text-xl font-bold">{gameUser.name}</div>
        </CardTitle>
        <CardDescription></CardDescription>
      </CardHeader>
      <CardContent className="relative flex flex-col justify-start">
        <div>
          <span className="text-sm font-normal">Score:</span>
          <div className="text-5xl font-bold">{gameTeam.score}</div>
        </div>
      </CardContent>
      <CardFooter className="text-sm text-gray-500">
        Player #{gameTeam.index}
      </CardFooter>
    </Card>
  );
}
