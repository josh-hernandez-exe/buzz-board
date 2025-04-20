import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { api, HydrateClient } from "@/trpc/server";

import { auth, gameAuth } from "@/server/auth";
import { Scoreboard } from "./Scoreboard";
import { logger } from "@/logger";

export default async function GamePage({
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
  const isGameAdminAuthed = gameSession?.gameAdmin?.gameId === gameId;
  const isGameUserAuthed = gameSession?.gameUser?.gameId === gameId;

  if (!isGameAdminAuthed && !isGameUserAuthed) {
    logger.error("Game admin or user not found for this game.");
    // Redirect to public scoreboard if not authenticated
    redirect(`/game/${gameId}/scoreboard/public`);
  }

  const currentGameState = await api.gameGeneral.currentGameState();

  if (!currentGameState) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Game Not Found</h1>
          <p>No game was found or not ready yet to be viewed.</p>
        </div>
      </main>
    );
  }

  logger.info(`Game Page: ${JSON.stringify(currentGameState, null, 2)}`);

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <Scoreboard gameState={currentGameState} />
        </div>
      </main>
    </HydrateClient>
  );
}
