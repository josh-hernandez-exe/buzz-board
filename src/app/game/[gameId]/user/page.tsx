import { GameFormat } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ok, err } from "neverthrow";

import { auth, gameAuth } from "@/server/auth";

import { api, HydrateClient } from "@/trpc/server";
import { GameBuzzerTab } from "@/app/_components/client/GameBuzzerTab";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/_components/ui/tabs";

import { logger } from "@/utils/logger";
import { InformationTab } from "./InformationTab";

export default async function GameUserPage({
  params,
}: {
  params: { gameId: string };
}) {
  const { gameId } = await params;
  const session = await auth();
  const gameSession = await gameAuth({
    headers: await headers(),
    user: session?.user,
  });

  if (!gameSession?.gameUser || gameSession.gameUser.gameId !== gameId) {
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

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
            <Tabs defaultValue="buzzer" className="w-[400px]">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="buzzer">Buzzer</TabsTrigger>
                <TabsTrigger value="information">Information</TabsTrigger>
              </TabsList>
              <TabsContent value="buzzer">
                <GameWhoBuzzedIn gameUserId={gameUser.id} />
                <GameBuzzerTab
                  game={game}
                  gameTeams={gameTeams}
                  initialGameTeamId={gameUser.gameTeamId}
                />
              </TabsContent>
              <TabsContent value="information">
                <InformationTab
                  gameState={currentGameState}
                  gameUser={gameUser}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </HydrateClient>
  );
}
