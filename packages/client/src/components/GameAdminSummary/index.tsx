import type { Game } from "@/types/serverTypes";
import { trpc } from "@/utils/trpc";

import { logger } from "@/utils/logger";

export function GameAdminSummary({ gameId }: { gameId: Game["id"] }) {
  logger.debug(`GameAdminSummary: $${gameId}`);

  const gameQuery = trpc.game.byId.useQuery(gameId);

  return (
    <div>
      <p>Game ID: {gameId}</p>
      <p>Game Name: {gameQuery.data?.name}</p>
    </div>
  );
}
