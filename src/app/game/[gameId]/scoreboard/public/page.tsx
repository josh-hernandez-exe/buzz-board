import { api, HydrateClient } from "@/trpc/server";

import { logger } from "@/logger";

import { PublicScoreboard } from "./PublicScoreboard";

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
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

  const currentGameState = await api.public.currentGameState({ gameId });

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
          <PublicScoreboard gameState={currentGameState} />
        </div>
      </main>
    </HydrateClient>
  );
}
