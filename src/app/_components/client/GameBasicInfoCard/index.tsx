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

import { GameUserEditSheet } from "@/app/_components/client/GameUserEditSheet";
import { api } from "@/trpc/react";

import { logger } from "@/utils/logger";

export function GameBasicInfoCard({
  game,
}: {
  game: Pick<Game, "id" | "name" | "format" | "code" | "isBuzzerListening">;
}) {
  const gameBasicInfo = api.gameGeneral.getBasicGameInfo.useQuery();

  const gameInfo = gameBasicInfo.data ?? game;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Game Info</CardTitle>
        <CardDescription>Game related information</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Game Name: {gameInfo?.name}</p>
        <p>Game Id: {gameInfo?.id}</p>
        <p>Game Code: {gameInfo?.code}</p>
        <p>Game Format: {gameInfo?.format}</p>
        <p>
          Game Buzzer State :{" "}
          {game.isBuzzerListening ? "Listening" : "Not Listening"}
        </p>
      </CardContent>
    </Card>
  );
}
