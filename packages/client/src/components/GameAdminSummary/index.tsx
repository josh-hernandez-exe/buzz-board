import type { Game } from "@/types/serverTypes";
import { trpc } from "@/utils/trpc";

import { logger } from "@/utils/logger";

export function GameAdminSummary({ gameId }: { gameId: Game["id"] }) {
  logger.debug(`GameAdminSummary: $${gameId}`);

  const gameQuery = trpc.game.byId.useQuery(gameId);
  const gameAdminQuery = trpc.gameAdmin.findByGameId.useQuery(gameId);

  if (gameQuery.data === undefined) return undefined;
  if (gameAdminQuery.data === undefined) return undefined;

  return (
    <div>
      <p>Game ID: {gameId}</p>
      <p>Game Name: {gameQuery.data.name}</p>
      <p>Game Admin Name: {gameAdminQuery.data[0].name}</p>
    </div>
  );
}
