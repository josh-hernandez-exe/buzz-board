import { GameFormat } from "@prisma/client";

import { ok, err } from "neverthrow";

import { api, HydrateClient } from "@/trpc/server";
import { GameBuzzer } from "@/app/_components/client/GameBuzzer";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/_components/ui/tabs";

import { logger } from "@/utils/logger";
import { GameUserInfo } from "./GameUserInfo";

export default async function GamePage({
  params,
}: {
  params: { gameId: string };
}) {
  const { gameId } = await params;

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
  const currentGameState = await api.public.currentGameState({ gameId });

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
                <TabsTrigger value="gameinfo">GameInfo</TabsTrigger>
              </TabsList>
              <TabsContent value="buzzer">
                <GameWhoBuzzedIn
                  gameUserId={gameUser.id}
                  gameTeamUserId={gameUser.gameTeamId}
                />
                <GameBuzzer
                  game={game}
                  gameTeams={gameTeams}
                  initialGameTeamId={gameUser.gameTeamId}
                />
              </TabsContent>
              <TabsContent value="gameinfo">
                <GameUserInfo
                  initialGameUser={gameUser}
                  initialGameState={currentGameState}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </HydrateClient>
  );
}
