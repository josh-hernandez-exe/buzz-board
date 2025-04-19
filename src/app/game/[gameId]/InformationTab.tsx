"use client";

import { GameFormat, type Game } from "@prisma/client";

import { GameUserInfoCard } from "@/app/_components/client/GameUserInfoCard";
import { GameTeamInfoCard } from "@/app/_components/client/GameTeamInfoCard";
import { GameBasicInfoCard } from "@/app/_components/client/GameBasicInfoCard";

import { api } from "@/trpc/react";

export function InformationTab({
  game,
}: {
  game: Pick<Game, "id" | "name" | "format" | "code">;
}) {
  return (
    <div className="flex flex-col items-center justify-center">
      <GameBasicInfoCard game={game} />
      <GameUserInfoCard />
      {game.format === GameFormat.team && <GameTeamInfoCard />}
    </div>
  );
}
