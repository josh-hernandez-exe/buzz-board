"use client";

import type {
  GameTeam,
  GameUser,
  BuzzerState,
  GameFormat,
} from "@prisma/client";

import { GenericCard } from "@/app/_components/client/GenericCard";

import { logger } from "@/utils/logger";
import type { GameWithRelations } from "@/types";

export function GameTeamSummaryCard({
  gameTeam,
  gameUsers,
  buzzerState,
  score,
}: {
  gameTeam: GameTeam | undefined;
  gameUsers: GameUser[] | undefined;
  buzzerState: BuzzerState;
  score: number | undefined;
}) {
  logger.debug(`GameTeamSummaryCard`);

  if (gameTeam === undefined) {
    return undefined;
  }

  const content = (
    <div>
      <p>Buzzer: {buzzerState}</p>
      <p>Score: {score || 0}</p>
      <p>Number of Players: {gameUsers?.length || 0}</p>
      <p>
        Members:
        {gameUsers?.map((gameUser: GameUser) => gameUser.name).join("; ")}
      </p>
    </div>
  );

  return <GenericCard title={gameTeam.name} content={content} />;
}
