"use client";

import { useState, useTransition } from "react";

import { GameAdminTeamControl } from "@/app/_components/client/GameAdminTeamControl";
import { GameTeamSummaryCard } from "@/app/_components/client/GameTeamSummaryCard";
import { GameAdminBuzzerControl } from "@/app/_components/client/GameAdminBuzzerControl";
import { GameAdminScoreboardAdvancedControl } from "@/app/_components/client/GameAdminScoreboardAdvancedControl";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";
import { GameBasicInfoCard } from "@/app/_components/client/GameBasicInfoCard";
import { RosterPanel } from "@/app/_components/client/RosterPanel";
import { GameSoundEffects } from "@/app/_components/client/GameSoundEffects";
import { Skeleton } from "@/app/_components/ui/skeleton";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/_components/ui/tabs";

import type { PrivateGameState } from "@/types";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { HostRoomPanel } from "@/app/_components/client/HostRoomPanel";
import { HelpersPanel } from "@/app/_components/client/HelpersPanel";
import { ChatPanel } from "@/app/_components/client/ChatPanel";
import { RankedAnswersPanel } from "@/app/_components/client/RankedAnswersPanel";
import { ROLE_LABEL, can, type StaffRoleName } from "@/utils/capabilities";

export function GameAdminInfo({
  gameState: initialGameState,
  staffRole,
}: {
  gameState: PrivateGameState;
  staffRole: StaffRoleName;
}) {
  const runsGame = can(staffRole, "runGame");
  const [activeTab, setActiveTab] = useState(
    runsGame ? "quick-controls" : "player-management",
  );
  const [isPending, startTransition] = useTransition();

  const handleTabChange = (value: string) => {
    startTransition(() => {
      setActiveTab(value);
    });
  };

  const gameStateSub = useLiveGameState();

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

      <div className="flex w-full max-w-[700px] flex-col gap-4">
        <p className="text-center" data-testid="my-role">
          You&apos;re the <strong>{ROLE_LABEL[staffRole]}</strong> of this game.
          {!runsGame &&
            " You can rename, move and remove players. The owner and co-hosts run the buzzer and scores."}
        </p>
        <HostRoomPanel staffRole={staffRole} />
      </div>
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="w-full max-w-[700px]"
      >
        <TabsList className="flex h-auto w-full flex-wrap">
          {runsGame && (
            <TabsTrigger value="quick-controls">Game Controls</TabsTrigger>
          )}
          {runsGame && (
            <TabsTrigger value="team-management">Team Management</TabsTrigger>
          )}
          {runsGame && (
            <TabsTrigger value="ranked-answers">Ranked Answers</TabsTrigger>
          )}
          <TabsTrigger value="player-management">Player Management</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="helpers">Helpers</TabsTrigger>
          <TabsTrigger value="information">Information</TabsTrigger>
        </TabsList>
        <TabsContent value="quick-controls">
          {isPending ? (
            <Skeleton className="h-[400px] w-full" />
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
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <>
              <GameAdminTeamControl gameTeams={gameTeams} />
              {gameTeams.map((gameTeam) => {
                const users = gameTeam.gameUsers.map(
                  (userId) => currentGameState.gameUsers[userId]!,
                );
                return (
                  <GameTeamSummaryCard
                    key={gameTeam.id}
                    gameTeam={gameTeam}
                    gameUsers={users}
                    score={gameTeam.score}
                  />
                );
              })}
            </>
          )}
        </TabsContent>
        <TabsContent value="ranked-answers">
          {isPending ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            runsGame && <RankedAnswersPanel />
          )}
        </TabsContent>
        <TabsContent value="player-management">
          {isPending ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <RosterPanel staffRole={staffRole} />
          )}
        </TabsContent>
        <TabsContent value="chat">
          {isPending ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <ChatPanel as="staff" staffRole={staffRole} />
          )}
        </TabsContent>
        <TabsContent value="helpers">
          {isPending ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <HelpersPanel />
          )}
        </TabsContent>
        <TabsContent value="information">
          {isPending ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <GameBasicInfoCard game={game} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
