import { MessagePage, PageShell } from "@/app/_components/ui/page";
import { AppHeader } from "@/app/_components/server/AppHeader";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { gameApi, HydrateClient } from "@/trpc/server";

import { auth, gameAuth } from "@/server/auth";
import { Scoreboard } from "./Scoreboard";
import { logger } from "@/logger";
import { GameScope } from "@/app/_components/client/GameScope";

export default async function GamePage({
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

  if (!gameId) {
    return (
      <MessagePage title="Game not found">
        <p className="text-muted-foreground">No game identifier was given.</p>
      </MessagePage>
    );
  }
  const isGameAdminAuthed = gameSession?.gameAdmin?.gameId === gameId;
  const isGameUserAuthed = gameSession?.gameUser?.gameId === gameId;

  if (!isGameAdminAuthed && !isGameUserAuthed) {
    logger.error("Game admin or user not found for this game.");
    // Redirect to public scoreboard if not authenticated
    redirect(`/game/${gameId}/scoreboard/public`);
  }

  const currentGameState = await (
    await gameApi(gameId)
  ).gameGeneral.currentGameState();

  if (!currentGameState) {
    return (
      <MessagePage title="Game not found">
        <p className="text-muted-foreground">
          No game was found or not ready yet to be viewed.
        </p>
      </MessagePage>
    );
  }

  return (
    <HydrateClient>
      <GameScope gameId={gameId} initialState={currentGameState}>
        <PageShell header={<AppHeader />} width="wide">
          <Scoreboard gameState={currentGameState} />
        </PageShell>
      </GameScope>
    </HydrateClient>
  );
}
