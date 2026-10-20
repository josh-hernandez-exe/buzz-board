import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GameFormat } from "@prisma/client";

import { auth, gameAuth } from "@/server/auth";

import { gameApi, HydrateClient } from "@/trpc/server";
import { GameBuzzerTab } from "@/app/_components/client/GameBuzzerTab";
import { TeamSwitcherTab } from "@/app/_components/client/TeamSwitcherTab";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";
import { GameSoundEffects } from "@/app/_components/client/GameSoundEffects";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/_components/ui/tabs";

import { logger } from "@/logger";
import { InformationTab } from "./InformationTab";
import { GameScope } from "@/app/_components/client/GameScope";
import { PlayerHeader } from "@/app/_components/client/PlayerStatus";

export default async function GameUserPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const session = await auth();
  const gameSession = await gameAuth({
    headers: await headers(),
    user: session?.user,
    gameId,
  });

  if (gameSession?.gameUser?.gameId !== gameId) {
    logger.error("Game user not found for this game.");
    redirect("/join");
  }

  if (!gameId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Game Not Found</h1>
          <p>No game identifier was given.</p>
        </div>
      </main>
    );
  }

  const api = await gameApi(gameId);
  const gameUser = await api.gameUser.getSelfInfo();
  const currentGameState = await api.gameGeneral.currentGameState();

  if (!gameUser) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Unauthorized</h1>
          <p>Game user not exist or you are not authorized.</p>
        </div>
      </main>
    );
  }

  const { game, gameTeams } = currentGameState;
  const isTeamGame = game.format === GameFormat.team;
  const hasTeamAssigned = gameUser.gameTeamId !== null;

  // Determine default tab:
  // - For team games: default to team switcher if user has no team, otherwise buzzer
  // - For individual games: default to buzzer
  const defaultTab =
    isTeamGame && !hasTeamAssigned ? "team-switcher" : "buzzer";

  return (
    <HydrateClient>
      <GameScope gameId={gameId} initialState={currentGameState}>
        <main className="flex min-h-screen flex-col items-center bg-gradient-to-b from-[#2e026d] to-[#15162c] px-4 py-6 text-white">
          {/* Game sound effects for the user's team */}
          <GameSoundEffects gameTeamId={gameUser.gameTeamId ?? undefined} />
          <div className="flex w-full max-w-md flex-col items-center gap-6">
            <PlayerHeader gameUserId={gameUser.id} />
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList
                className={`grid w-full ${isTeamGame ? "grid-cols-3" : "grid-cols-2"}`}
              >
                <TabsTrigger value="buzzer">Buzzer</TabsTrigger>
                {isTeamGame && (
                  <TabsTrigger value="team-switcher">Team</TabsTrigger>
                )}
                <TabsTrigger value="information">Info</TabsTrigger>
              </TabsList>
              <TabsContent value="buzzer" className="flex flex-col gap-4">
                <GameBuzzerTab gameUserId={gameUser.id} />
                <GameWhoBuzzedIn gameUserId={gameUser.id} />
              </TabsContent>
              {isTeamGame && (
                <TabsContent value="team-switcher">
                  <TeamSwitcherTab
                    game={game}
                    gameTeams={gameTeams}
                    initialGameTeamId={gameUser.gameTeamId}
                  />
                </TabsContent>
              )}
              <TabsContent value="information">
                <InformationTab
                  gameState={currentGameState}
                  gameUser={gameUser}
                />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </GameScope>
    </HydrateClient>
  );
}
