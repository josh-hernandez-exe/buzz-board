import { GameTeamSummaryCard } from "@/components/GameTeamSummaryCard";

import type { Game, GameTeam } from "@/types/serverTypes";
import { trpc } from "@/utils/trpc";

import { logger } from "@/utils/logger";

export function AllGameTeamSummaryGrid({ gameId }: { gameId: Game["id"] }) {
  logger.debug("AllGameTeamSummaryGrid");
  const gameTeamsQuery = trpc.gameTeam.findByGameId.useQuery(gameId);

  if (gameTeamsQuery.data === undefined) {
    return undefined;
  }

  return (
    <div>
      {gameTeamsQuery.data.map((gameTeam: GameTeam) => {
        return (
          <GameTeamSummaryCard
            key={gameTeam.id}
            gameId={gameId}
            gameTeamId={gameTeam.id}
          />
        );
      })}
    </div>
  );
}
