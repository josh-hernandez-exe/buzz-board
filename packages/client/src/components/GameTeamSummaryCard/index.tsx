import { GenericCard } from "@/components/GenericCard";

import type { GameTeam, GameUser } from "@/types/serverTypes";
import { SingleBuzzerState } from "@/types/serverTypes";
import { trpc } from "@/utils/trpc";

import { logger } from "@/utils/logger";

export function GameTeamSummaryCard({
  gameId,
  gameTeamId,
}: {
  gameId: GameTeam["id"];
  gameTeamId: GameTeam["id"];
}) {
  logger.debug(`GameTeamSummaryCard`);

  const gameTeamQuery = trpc.gameTeam.byId.useQuery(gameTeamId);
  const buzzerQuery = trpc.buzzerState.findByGameId.useQuery(gameId);
  const scoreboardQuery = trpc.scoreboard.findByGameId.useQuery(gameId);
  const gameUsersQuery = trpc.gameUser.findByGameTeamId.useQuery(gameTeamId);

  if (gameTeamQuery.data === undefined) return undefined;
  if (buzzerQuery.data === undefined) return undefined;
  if (scoreboardQuery.data === undefined) return undefined;
  if (gameUsersQuery.data === undefined) return undefined;

  const buzzerState =
    SingleBuzzerState[buzzerQuery.data[0].buzzers[gameTeamId]];

  const content = (
    <div>
      <p>Buzzer: {buzzerState}</p>
      <p>Score: {scoreboardQuery.data[0].current[gameTeamId]}</p>
      <p>
        Members:
        {gameUsersQuery.data
          .map((gameUser: GameUser) => gameUser.name)
          .join("; ")}
      </p>
    </div>
  );

  return (
    <GenericCard
      key={gameTeamId}
      title={gameTeamQuery.data.name}
      content={content}
    />
  );
}
