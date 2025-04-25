"use client";

import { DateTime } from "luxon";

import { api } from "@/trpc/react";

import { useGameTokenData } from "@/app/_hooks/gameTokenData";

import type { GameWithRelations } from "@/types";
import { logger } from "@/logger";

import { GameTeamUserTable } from "./GameViewDataTable";
import type { GameViewDataTableRow } from "./gameViewColumns";

export function UserGameView({
  games: initialGames,
}: {
  games: GameWithRelations[];
}) {
  const [, setGameIdData] = useGameTokenData();
  const gameInfo = api.user.game.getAll.useQuery();

  const gameData = gameInfo.data ?? initialGames;

  const games: GameViewDataTableRow[] = gameData.map((game) => {
    return {
      ...game,
      gameId: game.id,
      numTeams: game.gameTeams.length,
      numPlayers: game.gameUsers.length,
      createdAt:
        game.createdAt instanceof Date // is it a built in JS Date type
          ? // convert to luxon DateTime
            DateTime.fromJSDate(game.createdAt)
          : // else default to now
            DateTime.now(),
    };
  });

  if (!games) {
    return <div>Loading...</div>;
  }

  const onSelectClick = (gameId: string) => {
    logger.debug(`GameView selected: ${gameId}`);
    setGameIdData({ gameId });
  };

  games.sort((a, b) => {
    if (
      DateTime.isDateTime(a.createdAt) &&
      DateTime.isDateTime(b.createdAt) &&
      a.createdAt.isValid &&
      b.createdAt.isValid
    ) {
      return a.createdAt.diff(b.createdAt).as("milliseconds");
    }

    logger.error("Invalid date format during game sorting.");
    return 0; // Fallback to no sorting if dates are invalid
  });

  return <GameTeamUserTable data={games} onSelectClick={onSelectClick} />;
}
