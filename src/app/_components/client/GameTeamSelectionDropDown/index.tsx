"use client";

import type { GameTeam } from "@prisma/client";

import {
  DropDownSelection,
  type DropdownOption,
} from "@/app/_components/client/DropDownSelection";

import { logger } from "@/utils/logger";

export function GameTeamSelectionDropDown({
  gameTeams,
  onChange,
}: {
  gameTeams: GameTeam[];
  onChange: (game: GameTeam) => void;
}) {
  logger.debug(`GameTeamSelectionDropDown`);

  const onValueChange = (game: GameTeam) => {
    onChange(game);
  };

  const options = gameTeams.map((gameTeam) => {
    return {
      id: gameTeam.id.slice(0, 8),
      name: gameTeam.name,
      data: gameTeam,
    } as DropdownOption<GameTeam>;
  });

  return (
    <DropDownSelection<GameTeam>
      title="Game Selection"
      options={options}
      onChange={onValueChange}
    />
  );
}
