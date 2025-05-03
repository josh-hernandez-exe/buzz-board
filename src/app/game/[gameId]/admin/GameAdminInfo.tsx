"use client";

import { api } from "@/trpc/react";

import { GameAdminTeamControl } from "@/app/_components/client/GameAdminTeamControl";
import { GameTeamSummaryCard } from "@/app/_components/client/GameTeamSummaryCard";
import { GameAdminBuzzerControl } from "@/app/_components/client/GameAdminBuzzerControl";
import { GameAdminScoreboardAdvancedControl } from "@/app/_components/client/GameAdminScoreboardAdvancedControl";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";
import { GameBasicInfoCard } from "@/app/_components/client/GameBasicInfoCard";

import { useGameTokenData } from "@/app/_hooks/gameTokenData";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/_components/ui/tabs";

import type { PrivateGameState, BasicGameInfo } from "@/types";

export function GameAdminInfo({
  gameState: initialGameState,
}: {
  gameState: PrivateGameState;
}) {
  useGameTokenData();
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
      <Tabs defaultValue="quick-controls" className="w-[500px]">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="quick-controls">Game Controls</TabsTrigger>
          <TabsTrigger value="team-management">Team Management</TabsTrigger>
          <TabsTrigger value="information">Information</TabsTrigger>
        </TabsList>
        <TabsContent value="quick-controls">
          <GameWhoBuzzedIn />
          <GameAdminBuzzerControl />
          <GameAdminScoreboardAdvancedControl
            gameTeams={gameTeams.map(
              ({ gameUsers: _gameUsers, ...gameTeam }) => gameTeam,
            )}
          />
        </TabsContent>
        <TabsContent value="team-management">
          <GameAdminTeamControl gameTeams={gameTeams} />
          {gameTeams.map(({ gameUsers, score, ...gameTeam }) => {
            // return undefined;
            return (
              <GameTeamSummaryCard
                key={gameTeam.id}
                gameTeam={gameTeam}
                gameUsers={gameUsers}
                score={score}
              />
            );
          })}
        </TabsContent>
        <TabsContent value="information">
          <GameBasicInfoCard game={game as BasicGameInfo} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
