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

import { logger } from "@/logger";

import type { GameTeamFromPublicState } from "@/types";

import { cn } from "@/app/_lib/utils";

export function GamePublicScoreboardTeamCard({
  gameId,
  gameTeam: initialGameTeam,
}: {
  gameId: string;
  gameTeam: GameTeamFromPublicState;
}) {
  const { id: gameTeamId } = initialGameTeam;
  const gameState = api.public.gameState.useSubscription({ gameId });

  const gameTeamFromState: GameTeamFromPublicState | undefined =
    gameState?.data?.gameTeams.find((team) => team.id === gameTeamId);

  const gameTeam = gameTeamFromState || initialGameTeam;

  if (!gameTeam) {
    return <div>Loading...</div>;
  }

  const cardColor = cn({
    "bg-white": gameTeam.buzzerState === BuzzerState.avilalble,
    "bg-green-500 text-white": gameTeam.buzzerState === BuzzerState.selected,
    "bg-red-500 text-white": gameTeam.buzzerState === BuzzerState.rejected,
  });

  const icon =
    gameTeam.buzzerState === BuzzerState.rejected ? (
      <X className="bottom-0 left-0 h-16 w-16 text-white opacity-30" />
    ) : null;

  return (
    <Card className={cardColor}>
      <CardHeader>
        <CardTitle>
          Team {gameTeam.index}: {gameTeam.name}
        </CardTitle>
        <CardDescription></CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-4xl font-bold">Score: {gameTeam.score}</div>
        {icon}
      </CardContent>
      <CardFooter>Num Players: {gameTeam.numPlayers}</CardFooter>
    </Card>
  );
}
