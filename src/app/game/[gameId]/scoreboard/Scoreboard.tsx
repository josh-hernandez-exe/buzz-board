"use client";

import { api } from "@/trpc/react";
import type { PrivateGameState } from "@/types";
import { ChevronsUpDown } from "lucide-react"

import { env } from "@/env";

import { GameScoreboardTeamCard } from "@/app/_components/client/GameScoreboardTeamCard";
import { GameBasicInfoCard } from "@/app/_components/client/GameBasicInfoCard";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";

import { Button } from "@/app/_components/ui/button"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/app/_components/ui/collapsible";

export function Scoreboard({
  gameState: initialGameState,
}: {
  gameState: PrivateGameState;
}) {
  const gameStateSub = api.gameGeneral.gameState.useSubscription();

  const currentGameState = gameStateSub.data ?? initialGameState;

  const { game, gameTeams } = currentGameState;

  return (
    <div className="mx-auto w-full max-w-screen-2xl p-4">
      <h1 className="mb-4 text-center text-2xl font-bold">
        Welcome to Game {game?.name}
      </h1>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            <span>Toggle Game Information</span>
            <ChevronsUpDown className="h-4 w-4" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <GameBasicInfoCard
            game={currentGameState.game}
            hideFields={["description", "name", "id", "format", "buzzerState"]}
            extraContent={
              <div className="text-center text-sm text-gray-500">
                <p>
                  To join the game, go to the join URL and use the game code
                  provided.
                </p>
                <p>{env.NEXT_PUBLIC_QRCODE_BASE_URL}/join</p>
              </div>
            }
          />
        </CollapsibleContent>
      </Collapsible>
      <GameWhoBuzzedIn />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {gameTeams.map((gameTeam) => {
          return (
            <GameScoreboardTeamCard key={gameTeam.id} gameTeam={gameTeam} />
          );
        })}
      </div>
    </div>
  );
}
