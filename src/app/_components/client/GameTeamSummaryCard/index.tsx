"use client";

import type { GameTeam, GameUser, BuzzerState } from "@prisma/client";

import { GenericCard } from "@/app/_components/GenericCard";

import { logger } from "@/utils/logger";

export function GameTeamSummaryCard({
  gameTeam,
  gameUsers,
  score,
}: {
  gameTeam: GameTeam | undefined;
  gameUsers: GameUser[] | undefined;
  score: number | undefined;
}) {
  logger.debug(`GameTeamSummaryCard`);

  if (gameTeam === undefined) {
    return undefined;
  }

  const content = (
    <div>
      <p>Score: {score ?? 0}</p>
      <p>Number of Players: {gameUsers?.length ?? 0}</p>
      <p>Team Buzzer State: {gameTeam.buzzerState}</p>
      <p>
        Members:
        {gameUsers?.map((gameUser: GameUser) => gameUser.name).join("; ")}
      </p>
    </div>
  );

  return <GenericCard title={gameTeam.name} content={content} />;
}
