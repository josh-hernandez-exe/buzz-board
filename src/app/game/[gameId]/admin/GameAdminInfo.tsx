"use client";

import { useState, useTransition } from "react";
import { api } from "@/trpc/react";

import { GameAdminTeamControl } from "@/app/_components/client/GameAdminTeamControl";
import { GameTeamSummaryCard } from "@/app/_components/client/GameTeamSummaryCard";
import { GameAdminBuzzerControl } from "@/app/_components/client/GameAdminBuzzerControl";
import { GameAdminScoreboardAdvancedControl } from "@/app/_components/client/GameAdminScoreboardAdvancedControl";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";
import { GameBasicInfoCard } from "@/app/_components/client/GameBasicInfoCard";
import { GamePlayerManagementTable } from "@/app/_components/client/GameAdminPlayerManagementTable";
import { GameSoundEffects } from "@/app/_components/client/GameSoundEffects";
import { Skeleton } from "@/app/_components/ui/skeleton";

import { useGameTokenData } from "@/app/_hooks/gameTokenData";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/_components/ui/tabs";

import type { PrivateGameState } from "@/types";

export function GameAdminInfo({
  gameState: initialGameState,
}: {
  gameState: PrivateGameState;
}) {
  useGameTokenData();
  const [activeTab, setActiveTab] = useState("quick-controls");
  const [isPending, startTransition] = useTransition();

  const handleTabChange = (value: string) => {
    startTransition(() => {
      setActiveTab(value);
    });
  };

  const gameStateSub = api.gameGeneral.gameState.useSubscription();

  const currentGameState: PrivateGameState =
    gameStateSub.data ?? initialGameState;

  if (!currentGameState) {
    return undefined;
  }

  const { game, gameTeams } = currentGameState;

  gameTeams?.sort((a, b) => a.index - b.index);

  return (
    <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
      {/* Game sound effects for all teams */}
      <GameSoundEffects />

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="w-[700px]"
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="quick-controls">Game Controls</TabsTrigger>
          <TabsTrigger value="team-management">Team Management</TabsTrigger>
          <TabsTrigger value="player-management">Player Management</TabsTrigger>
          <TabsTrigger value="information">Information</TabsTrigger>
        </TabsList>
        <TabsContent value="quick-controls">
          {isPending ? (
            <Skeleton className="h-[400px] w-[700px]" />
          ) : (
            <>
              <GameWhoBuzzedIn />
              <GameAdminBuzzerControl />
              <GameAdminScoreboardAdvancedControl
                gameTeams={gameTeams.map(
                  ({ gameUsers: _gameUsers, ...gameTeam }) => gameTeam,
                )}
              />
            </>
          )}
        </TabsContent>
        <TabsContent value="team-management">
          {isPending ? (
            <Skeleton className="h-[400px] w-[700px]" />
          ) : (
            <>
              <GameAdminTeamControl gameTeams={gameTeams} />
              {gameTeams.map(({ gameUsers, score, ...gameTeam }) => {
                return (
                  <GameTeamSummaryCard
                    key={gameTeam.id}
                    gameTeam={gameTeam}
                    gameUsers={gameUsers}
                    score={score}
                  />
                );
              })}
            </>
          )}
        </TabsContent>
        <TabsContent value="player-management">
          {isPending ? (
            <Skeleton className="h-[400px] w-[700px]" />
          ) : (
            <GamePlayerManagementTable gameState={currentGameState} />
          )}
        </TabsContent>
        <TabsContent value="information">
          {isPending ? (
            <Skeleton className="h-[400px] w-[700px]" />
          ) : (
            <GameBasicInfoCard game={game} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
