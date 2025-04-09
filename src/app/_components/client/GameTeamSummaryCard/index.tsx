"use client";

import type { GameTeam, GameUser, BuzzerState } from "@prisma/client";

import { GenericCard } from "@/app/_components/client/GenericCard";

import { logger } from "@/utils/logger";

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
      <p>Score: {score}</p>
      <p>
        Members:
        {gameUsers?.map((gameUser: GameUser) => gameUser.name).join("; ")}
      </p>
    </div>
  );

  return (
    <GenericCard key={gameTeam.id} title={gameTeam.name} content={content} />
  );
}
