import { TRPCError } from "@trpc/server";

import { MessagePage, PageShell } from "@/app/_components/ui/page";
import { api, HydrateClient } from "@/trpc/server";

import { PublicScoreboard } from "./PublicScoreboard";

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;

  if (!gameId) {
    return (
      <MessagePage title="Game not found">
        <p className="text-muted-foreground">No game identifier was given.</p>
      </MessagePage>
    );
  }

  // Only a missing game is "not found"; anything else (database or Redis
  // outages, bugs) must surface as a server error rather than a 404 page.
  const currentGameState = await api.public
    .currentGameState({ gameId })
    .catch((error: unknown) => {
      if (error instanceof TRPCError && error.code === "NOT_FOUND") return null;
      throw error;
    });

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
      <PageShell stage width="full">
        <PublicScoreboard gameState={currentGameState} />
      </PageShell>
    </HydrateClient>
  );
}
