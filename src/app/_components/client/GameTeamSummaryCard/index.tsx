"use client";

import type { GameTeam, GameUser } from "@prisma/client";

import { GenericCard } from "@/app/_components/GenericCard";

import { logger } from "@/logger";

export function GameTeamSummaryCard({
  gameTeam,
  gameUsers,
  score,
}: {
  gameTeam: Pick<GameTeam, "id" | "name" | "buzzerState"> | undefined;
  gameUsers: Pick<GameUser, "id" | "name">[] | undefined;
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
        {gameUsers?.map((gameUser) => gameUser.name).join("; ")}
      </p>
    </div>
  );

  return <GenericCard title={gameTeam.name} content={content} />;
}
