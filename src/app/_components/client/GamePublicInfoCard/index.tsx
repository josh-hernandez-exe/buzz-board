"use client";

import { type Game } from "@prisma/client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/app/_components/ui/card";

import { api } from "@/trpc/react";

import type { PublicGameState } from "@/types";

import { logger } from "@/utils/logger";

export function GamePublicInfoCard({
  game,
}: {
  game: PublicGameState["game"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Game Info</CardTitle>
        <CardDescription>Game related information</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Game Name: {game?.name}</p>
        <p>Game Id: {game?.id}</p>
        <p>Game Format: {game?.format}</p>
        <p>
          Game Buzzer State :{" "}
          {game.isBuzzerListening ? "Listening" : "Not Listening"}
        </p>
      </CardContent>
    </Card>
  );
}
