"use client";

import { Prisma } from "@prisma/client";

import {
  DropDownSelection,
  type DropdownOption,
} from "@/app/_components/client/DropDownSelection";

import { api } from "@/trpc/react";
import type { GameWithRelations } from "@/types";

import { logger } from "@/utils/logger";

export function GameSelectionDropDown({
  games,
  onChange,
}: {
  games: GameWithRelations[];
  onChange: (game: GameWithRelations) => void;
}) {
  logger.debug(`GameSelectionDropDown`);

  const onValueChange = (game: GameWithRelations) => {
    onChange(game);
  };

  const options = games.map((game) => {
    return {
      id: game.id.slice(0, 8),
      name: game.name,
      data: game,
    } as DropdownOption<typeof game>;
  });

  return (
    <DropDownSelection<GameWithRelations>
      title="Game Selection"
      options={options}
      onChange={onValueChange}
    />
  );
}
