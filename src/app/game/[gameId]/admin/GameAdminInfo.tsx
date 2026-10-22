"use client";

import { useState } from "react";

import { BuzzerPanel } from "@/app/_components/client/BuzzerPanel";
import { CategoryGridPanel } from "@/app/_components/client/CategoryGridPanel";
import { ChatPanel } from "@/app/_components/client/ChatPanel";
import { GameBasicInfoCard } from "@/app/_components/client/GameBasicInfoCard";
import { GameSoundEffects } from "@/app/_components/client/GameSoundEffects";
import { HelpersPanel } from "@/app/_components/client/HelpersPanel";
import { HostGameBar } from "@/app/_components/client/HostGameBar";
import { HostRoomPanel } from "@/app/_components/client/HostRoomPanel";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { RankedAnswersPanel } from "@/app/_components/client/RankedAnswersPanel";
import { SequentialQuizPanel } from "@/app/_components/client/SequentialQuizPanel";
import { RosterPanel } from "@/app/_components/client/RosterPanel";
import { ScoresPanel } from "@/app/_components/client/ScoresPanel";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/_components/ui/tabs";
import type { PrivateGameState } from "@/types";
import { can, type StaffRoleName } from "@/utils/capabilities";
import type { ModeKind } from "@/utils/modes";

const MODE_TAB: Record<ModeKind, string> = {
  rankedAnswers: "ranked-answers",
  categoryGrid: "category-grid",
  sequentialQuiz: "quiz",
};

/**
 * The host desk. Play holds everything needed mid-question; the other tabs
 * are for setting up and looking after the room.
 */
export function GameAdminInfo({
  gameState: initialGameState,
  staffRole,
  modeKind = null,
  modeFirst = false,
}: {
  gameState: PrivateGameState;
  staffRole: StaffRoleName;
  /** The game mode this game is set up for, if any. */
  modeKind?: ModeKind | null;
  /** Open on the mode's tab (the game was set up for it). */
  modeFirst?: boolean;
}) {
  const runsGame = can(staffRole, "runGame");
  // A game runs one mode: show its tab, or all of them while none is chosen.
  const shows = (kind: ModeKind) =>
    runsGame && (modeKind === null || modeKind === kind);
  const showRanked = shows("rankedAnswers");
  const showGrid = shows("categoryGrid");
  const showQuiz = shows("sequentialQuiz");
  const [activeTab, setActiveTab] = useState(
    !runsGame ? "players" : modeFirst && modeKind ? MODE_TAB[modeKind] : "play",
  );
  const { data } = useLiveGameState();
  const state = data ?? initialGameState;

  return (
    <div className="flex w-full flex-col gap-4">
      <GameSoundEffects />
      <HostGameBar staffRole={staffRole} />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          {runsGame && <TabsTrigger value="play">Play</TabsTrigger>}
          {showRanked && (
            <TabsTrigger value="ranked-answers">Ranked Answers</TabsTrigger>
          )}
          {showGrid && (
            <TabsTrigger value="category-grid">Category Grid</TabsTrigger>
          )}
          {showQuiz && <TabsTrigger value="quiz">Quiz</TabsTrigger>}
          <TabsTrigger value="players">Players</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="room">Room</TabsTrigger>
        </TabsList>
        {runsGame && (
          <TabsContent value="play">
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <BuzzerPanel />
              <ScoresPanel />
            </div>
          </TabsContent>
        )}
        {showRanked && (
          <TabsContent value="ranked-answers">
            <RankedAnswersPanel />
          </TabsContent>
        )}
        {showGrid && (
          <TabsContent value="category-grid">
            <CategoryGridPanel />
          </TabsContent>
        )}
        {showQuiz && (
          <TabsContent value="quiz">
            <SequentialQuizPanel />
          </TabsContent>
        )}
        <TabsContent value="players" className="flex flex-col gap-4">
          <RosterPanel staffRole={staffRole} />
        </TabsContent>
        <TabsContent value="chat">
          <ChatPanel as="staff" staffRole={staffRole} />
        </TabsContent>
        <TabsContent value="room">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <HostRoomPanel staffRole={staffRole} />
            <div className="flex flex-col gap-4">
              <HelpersPanel />
              <GameBasicInfoCard
                game={state.game}
                hideFields={["qr", "code"]}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
