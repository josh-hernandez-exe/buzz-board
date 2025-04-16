import { GameFormat } from "@prisma/client";

import { ok, err } from "neverthrow";

import { api, HydrateClient } from "@/trpc/server";
import { GameBuzzer } from "@/app/_components/client/GameBuzzer";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";
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
          <GameUserInfo
            initialGameUser={gameUser}
            initialGameState={currentGameState}
          />
          <GameWhoBuzzedIn gameUserId={gameUser.id} />
          <GameBuzzer
            game={game}
            gameTeams={gameTeams}
            initialGameTeamId={gameUser.gameTeamId}
          />
        </div>
      </main>
    </HydrateClient>
  );
}
