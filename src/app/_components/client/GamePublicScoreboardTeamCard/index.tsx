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

import type { GameTeamFromPublicState } from "@/types";

import { cn } from "@/app/_lib/utils";
import { usePublicLiveGameState } from "@/app/_components/client/LiveGameState";

export function GamePublicScoreboardTeamCard({
  gameId: _gameId,
  gameTeam: initialGameTeam,
}: {
  gameId: string;
  gameTeam: GameTeamFromPublicState;
}) {
  const { id: gameTeamId } = initialGameTeam;
  const gameState = usePublicLiveGameState();

  const gameTeamFromState: GameTeamFromPublicState | undefined =
    gameState?.data?.gameTeams.find((team) => team.id === gameTeamId);

  const gameTeam = gameTeamFromState ?? initialGameTeam;

  if (!gameTeam) {
    return <div>Loading...</div>;
  }

  const cardColor = cn({
    "bg-surface": gameTeam.buzzerState === BuzzerState.available,
    "bg-success text-success-foreground":
      gameTeam.buzzerState === BuzzerState.selected,
    "bg-destructive text-destructive-foreground":
      gameTeam.buzzerState === BuzzerState.rejected,
  });

  const icon =
    gameTeam.buzzerState === BuzzerState.rejected ? (
      <X className="text-foreground bottom-0 left-0 h-16 w-16 opacity-30" />
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
