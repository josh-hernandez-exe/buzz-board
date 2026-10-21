"use client";

import { env } from "@/env";

import type { Prisma } from "@prisma/client";

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

  const gameUser = initialGameUser ?? gameSelfInfo.data;

  if (!gameUser) {
    return <div>Loading...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>You</CardTitle>
        <CardDescription>How you appear in this game</CardDescription>
      </CardHeader>
      <CardContent>
        <GameUserAvatar image={gameUser?.user?.image} index={gameUser?.index} />
        <p>Name: {gameUser?.name}</p>
        <p>Player number: {gameSelfInfo.data?.index}</p>
        {env.NEXT_PUBLIC_SHOW_DEBUG_INFO && (
          <p>Player ID: {gameSelfInfo.data?.id}</p>
        )}
      </CardContent>
      <CardFooter>
        <GameUserEditSheet />
      </CardFooter>
    </Card>
  );
}
