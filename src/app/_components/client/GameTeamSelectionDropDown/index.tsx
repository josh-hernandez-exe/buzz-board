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
  gameTeams: Array<{ id: GameTeam["id"]; name: GameTeam["name"] }>;
  onChange: (game: (typeof gameTeams)[number]) => void;
}) {
  logger.debug(`GameTeamSelectionDropDown`);

  const options = gameTeams.map((gameTeam) => {
    return {
      id: gameTeam.id.slice(0, 8),
      name: gameTeam.name,
      data: gameTeam,
    } as DropdownOption<(typeof gameTeams)[number]>;
  });

  return (
    <DropDownSelection<(typeof gameTeams)[number]>
      title="Game Selection"
      options={options}
      onChange={onChange}
    />
  );
}
