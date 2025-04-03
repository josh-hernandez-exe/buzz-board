import type { GameTeam } from "@/types/serverTypes";
import { trpc } from "@/utils/trpc";

import { logger } from "@/utils/logger";

export function GameAllTeamsList({ gameId }: { gameId: GameTeam["gameId"] }) {
  logger.debug(`GameAllTeamsList`);

  const gameTeamsQuery = trpc.gameTeam.findByGameId.useQuery(gameId);

  const teamNames = gameTeamsQuery.data?.map(
    (gameTeam: GameTeam) => gameTeam.name
  );

  if (teamNames === undefined) return null;

  return <p>{teamNames.join("\n")}</p>;
}
