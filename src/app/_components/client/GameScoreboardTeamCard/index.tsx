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

import type {
  GameTeamFromPrivateState,
  GameUserFromPrivateState,
} from "@/types";

import { cn } from "@/app/_lib/utils";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";

export function GameScoreboardTeamCard({
  gameTeam: initialGameTeam,
  gameUsers: initialGameUsers,
}: {
  gameTeam: GameTeamFromPrivateState;
  gameUsers: GameUserFromPrivateState[];
}) {
  const { id: gameTeamId } = initialGameTeam;
  const gameState = useLiveGameState();

  const gameTeamFromState: GameTeamFromPrivateState | undefined =
    gameState?.data?.gameTeams.find((team) => team.id === gameTeamId);

  const gameTeam = gameTeamFromState ?? initialGameTeam;

  const gameUsers =
    gameTeam.gameUsers.map((userId) => gameState?.data?.gameUsers[userId]) ??
    initialGameUsers;

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
      <X className="text-foreground absolute inset-0 h-full w-full opacity-30" />
    ) : null;

  return (
    <Card className={cn(cardColor, "relative")}>
      {icon}
      <CardHeader>
        <CardTitle>
          <div>
            <span className="text-sm font-normal">Team {gameTeam.index}:</span>
            <div className="h-14 text-xl font-bold">{gameTeam.name}</div>
          </div>
        </CardTitle>
        <CardDescription></CardDescription>
      </CardHeader>
      <CardContent className="relative flex flex-col justify-start">
        <div>
          <span className="text-sm font-normal">Score:</span>
          <div className="text-5xl font-bold">{gameTeam.score}</div>
        </div>
      </CardContent>
      <CardFooter>Num Players: {gameUsers.length}</CardFooter>
    </Card>
  );
}
