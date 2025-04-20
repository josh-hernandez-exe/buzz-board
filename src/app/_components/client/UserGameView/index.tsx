"use client";

import { DateTime } from "luxon";

import { api } from "@/trpc/react";

import { useRouter } from "next/navigation";

import { useGameTokenData } from "@/app/_hooks/gameTokenData";

import type { GameWithRelations } from "@/types";
import { logger } from "@/utils/logger";

import { GameTeamUserTable } from "./GameViewDataTable";
import type { GameViewDataTableRow } from "./gameViewColumns";

export function UserGameView({
  games: initialGames,
}: {
  games: GameWithRelations[];
}) {
  const router = useRouter();
  const [, setGameIdData] = useGameTokenData();
  const gameInfo = api.user.game.getAll.useQuery();

  const gameData = gameInfo.data || initialGames;

  const games: GameViewDataTableRow[] = gameData.map((game) => {
    return {
      ...game,
      gameId: game.id,
      numTeams: game.gameTeams.length,
      numPlayers: game.gameUsers.length,
      createdAt: DateTime.fromJSDate(game.createdAt),
    };
  });

  if (!games) {
    return <div>Loading...</div>;
  }

  const onSelectClick = (gameId: string) => {
    logger.debug(`GameView selected: ${gameId}`);
    setGameIdData({ gameId });
    router.push(`/game/${gameId}/admin`);
  };

  games.sort((a, b) => a.createdAt.diff(b.createdAt).as("milliseconds"));

  return <GameTeamUserTable data={games} onSelectClick={onSelectClick} />;
}
