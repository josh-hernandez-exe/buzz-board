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

  const currentGameState = await api.public
    .currentGameState({ gameId })
    .catch(() => null);

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
