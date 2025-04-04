import { useState } from "react";

import { AllGameTeamSummaryGrid } from "@/components/AllGameTeamSummaryGrid";
import { GameSelectionDropDown } from "@/components/GameSelectionDropDown";
import { GameAdminSummary } from "@/components/GameAdminSummary";

import type { Game } from "@/types/serverTypes";

import { logger } from "@/utils/logger";

export function PrototypeSuperAdminView() {
  const [game, setGame] = useState<Game>();

  if (game === undefined || game === null) {
    logger.debug(`PrototypeView: No Game Selected`);
  } else {
    logger.debug(`PrototypeView: Game ${game.id}`);
  }

  return (
    <div>
      <GameSelectionDropDown onChange={setGame} />
      {game && <GameAdminSummary gameId={game.id} />}
      {game && <AllGameTeamSummaryGrid gameId={game.id} />}
    </div>
  );
}
