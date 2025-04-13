"use client";

import { useState } from "react";
import { GameFormat } from "@prisma/client";
import type { Game, GameTeam, GameUser } from "@prisma/client";

import { Button } from "@/app/_components/ui/button";
import { GameTeamSelectionDropDown } from "@/app/_components/client/GameTeamSelectionDropDown";
import { useGameTokenData } from "@/app/_hooks/gameTokenData";
import { api, updateExtraHeaders } from "@/trpc/react";

import { logger } from "@/utils/logger";

export function GameBuzzer({
  game,
  gameTeams,
  gameUser,
}: {
  game: Game;
  gameTeams: GameTeam[];
  gameUser: GameUser;
}) {
  const utils = api.useUtils();
  const [gameTokenData, setGameTokenData] = useGameTokenData();

  if (!Array.isArray(gameTeams)) {
    return undefined;
  }

  const gameTeamFromGameUser = gameTeams.find(
    (team) => team.id === gameUser.gameTeamId,
  );
  const [selectedGameTeam, setSelectedGameTeam] = useState<GameTeam>(
    gameTeamFromGameUser ?? gameTeams[0]!,
  );

  const addTeamMutation = api.gameUser.changeTeams.useMutation({
    onSuccess: async ({ gameTeamId }) => {
      setSelectedGameTeam(gameTeams.find((team) => team.id === gameTeamId)!);
    },
  });

  const onTeamChange = (gameTeam: GameTeam) => {
    logger.debug(`GameInfoAdmin selected: ${JSON.stringify(selectedGameTeam)}`);
    addTeamMutation.mutate({
      gameTeamId: gameTeam.id,
    });
  };

  const buzzInMutation = api.gameUser.buzzIn.useMutation({
    onSuccess: async () => {
      logger.info("Buzzed in");
    },
    onError: (error) => {
      if (error.message === "Game is not listening for buzzers") {
        logger.error("Game is not listening for buzzers");
      }
    },
  });

  gameTeams.sort((a, b) => a.index - b.index);

  return (
    <div>
      {game.format === GameFormat.team && (
        <GameTeamSelectionDropDown
          gameTeams={gameTeams}
          onChange={onTeamChange}
        />
      )}
      {!addTeamMutation.isPending && selectedGameTeam && (
        <Button
          onClick={() => buzzInMutation.mutate()}
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Buzzer
        </Button>
      )}
    </div>
  );
}
