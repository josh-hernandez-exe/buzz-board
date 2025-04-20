"use client";

import { Prisma } from "@prisma/client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/app/_components/ui/card";

import { GameUserAvatar } from "@/app/_components/client/GameUserAvatar";
import { GameUserEditSheet } from "@/app/_components/client/GameUserEditSheet";
import { api } from "@/trpc/react";

import { logger } from "@/logger";

type GameUserProps = Prisma.GameUserGetPayload<{
  select: {
    id: true;
    name: true;
    index: true;
    user: {
      select: {
        image: true;
      };
    };
  };
}>;

export function GameUserInfoCard({
  gameUser: initialGameUser,
}: {
  gameUser?: GameUserProps | undefined;
}) {
  const gameSelfInfo = api.gameUser.getSelfInfo.useQuery();

  if (gameSelfInfo.isLoading) {
    return <div>Loading...</div>;
  }

  const gameUser = initialGameUser || gameSelfInfo.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Player Info</CardTitle>
        <CardDescription>Player related information</CardDescription>
      </CardHeader>
      <CardContent>
        <GameUserAvatar
          image={gameUser?.user?.image ?? undefined}
          index={gameUser?.index!}
        />
        <p>Player Name: {gameUser?.name}</p>
        <p>Player Index Number: {gameSelfInfo.data?.index}</p>
        <p>Player Id: {gameSelfInfo.data?.id}</p>
      </CardContent>
      <CardFooter>
        <GameUserEditSheet />
      </CardFooter>
    </Card>
  );
}
