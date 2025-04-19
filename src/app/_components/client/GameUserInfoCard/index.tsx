"use client";

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

import { logger } from "@/utils/logger";

export function GameUserInfoCard() {
  const gameSelfInfo = api.gameUser.getSelfInfo.useQuery();

  if (gameSelfInfo.isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Player Info</CardTitle>
        <CardDescription>Player related information</CardDescription>
      </CardHeader>
      <CardContent>
        <GameUserAvatar
          image={gameSelfInfo?.data?.user?.image ?? undefined}
          index={gameSelfInfo?.data?.index!}
        />
        <p>Player Name: {gameSelfInfo.data?.name}</p>
        <p>Player Index Number: {gameSelfInfo.data?.index}</p>
        <p>Player Id: {gameSelfInfo.data?.id}</p>
      </CardContent>
      <CardFooter>
        <GameUserEditSheet />
      </CardFooter>
    </Card>
  );
}
