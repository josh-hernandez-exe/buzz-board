"use client";

import { useState } from "react";
import { Prisma, type Game } from "@prisma/client";

import { GameAdminSummary } from "@/app/_components/client/GameAdminSummary";
import { GameSelectionDropDown } from "@/app/_components/GameSelectionDropDown";

import { api } from "@/trpc/react";
import { logger } from "@/utils/logger";
import type { GameWithRelations } from "@/types";

export function GameInfoAdmin({ games }: { games: GameWithRelations[] }) {
  if (games === undefined || !Array.isArray(games) || games.length === 0) {
    return undefined;
  }

  const [selectedGame, setSelectedGame] = useState<GameWithRelations>(
    games[0]!,
  );

  const onChange = (game: GameWithRelations) => {
    logger.debug(`GameInfoAdmin selected: ${JSON.stringify(selectedGame)}`);
    setSelectedGame(game);
  };

  return (
    <div>
      <GameSelectionDropDown games={games} onChange={onChange} />
      {selectedGame && <GameAdminSummary game={selectedGame} />}
    </div>
  );
}
