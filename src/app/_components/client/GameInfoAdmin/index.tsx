"use client";

import { useState } from "react";
import { type Game, GameFormat } from "@prisma/client";

import { GameAdminSummary } from "@/app/_components/client/GameAdminSummary";
import { GameSelectionDropDown } from "@/app/_components/client/GameSelectionDropDown";

import { Button } from "@/app/_components/ui/button";
import { useGameIdData } from "@/app/_hooks/gameTokenData";
import { api, updateExtraHeaders } from "@/trpc/react";
import { logger } from "@/utils/logger";

export function GameInfoAdmin({ games }: { games: Game[] }) {
  if (games === undefined || !Array.isArray(games) || games.length === 0) {
    return undefined;
  }
  const utils = api.useUtils();
  const [selectedGame, setSelectedGame] = useState<Game>(games[0]!);
  const [_, setGameTokenData] = useGameIdData(games[0]!.id);

  const onChange = (game: Game) => {
    logger.debug(`GameInfoAdmin selected: ${JSON.stringify(selectedGame)}`);
    setSelectedGame(game);

    // TODO: make something response to this sooner and have the child compoenents
    //       go into a loading state.
    utils.gameAdmin.getAllInfo.invalidate();
    setGameTokenData({
      gameId: game.id,
    });
  };

  if (selectedGame !== undefined) {
    updateExtraHeaders({ gameId: selectedGame.id });
  }

  const addTeamMutation = api.gameAdmin.addTeam.useMutation({
    onSuccess: async () => {
      await utils.gameAdmin.getAllInfo.invalidate();
    },
  });

  return (
    <div>
      <GameSelectionDropDown games={games} onChange={onChange} />
      {selectedGame && selectedGame.format === GameFormat.team && (
        <Button
          onClick={() => {
            addTeamMutation.mutate();
          }}
          disabled={addTeamMutation.isPending}
        >
          {addTeamMutation.isPending ? "(Loading New Team)" : "Add Team"}
        </Button>
      )}
      {selectedGame && <GameAdminSummary gameId={selectedGame.id} />}
    </div>
  );
}
