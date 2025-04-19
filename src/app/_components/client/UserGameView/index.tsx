"use client";

import { DateTime } from "luxon";

import { api } from "@/trpc/react";

import { GameTeamUserTable } from "./GameViewDataTable";
import type { GameViewDataTableRow } from "./gameViewColumns";

import type { GameWithRelations } from "@/types";
import { logger } from "@/utils/logger";

export function UserGameView({
  games: initialGames,
}: {
  games: GameWithRelations[];
}) {
  const gameInfo = api.user.game.getAll.useQuery();

  const gameData = gameInfo.data || initialGames;

  const games: GameViewDataTableRow[] = gameData.map((game) => {
    return {
      ...game,
      numTeams: game.gameTeams.length,
      numPlayers: game.gameUsers.length,
      createdAt: DateTime.fromJSDate(game.createdAt),
    };
  });

  if (!games) {
    return <div>Loading...</div>;
  }

  games.sort((a, b) => a.createdAt.diff(b.createdAt).as("milliseconds"));

  return <GameTeamUserTable data={games} />;
}
