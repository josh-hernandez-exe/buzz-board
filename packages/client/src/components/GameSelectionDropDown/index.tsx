import {
  DropDownSelection,
  type DropdownOption,
} from "@/components/DropDownSelection";

import type { Game } from "@/types/serverTypes";
import { trpc } from "@/utils/trpc";

import { logger } from "@/utils/logger";

export function GameSelectionDropDown({
  onChange,
}: {
  onChange: (gameId: Game) => void;
}) {
  logger.debug(`GameSelectionDropDown`);

  const gameListQuery = trpc.game.list.useQuery();

  const onValueChange = (game: Game) => {
    onChange(game);
  };

  const options = gameListQuery.data?.map((game: Game) => {
    return {
      id: game.id.slice(0, 8),
      name: game.name,
      data: game,
    } as DropdownOption<Game>;
  });

  return (
    <DropDownSelection<Game>
      title="Game Selection"
      options={options}
      onChange={onValueChange}
    />
  );
}
