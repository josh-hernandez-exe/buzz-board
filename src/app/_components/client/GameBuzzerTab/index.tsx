"use client";

import { useState } from "react";
import { GameFormat } from "@prisma/client";
import type { Game, GameTeam, GameUser } from "@prisma/client";

import { Button } from "@/app/_components/ui/button";
import { GameTeamSelection } from "@/app/_components/client/GameTeamSelection";
import { useGameTokenData } from "@/app/_hooks/gameTokenData";
import { api } from "@/trpc/react";

import { logger } from "@/logger";

export function GameBuzzerTab({
  game,
  gameTeams,
  initialGameTeamId,
}: {
  game: Pick<Game, "id" | "format">;
  gameTeams: Pick<GameTeam, "id" | "name" | "index">[];
  initialGameTeamId: GameTeam["id"] | undefined | null;
}) {
  const utils = api.useUtils();

  useGameTokenData();

  if (!Array.isArray(gameTeams)) {
    return undefined;
  }

  const gameTeamFromGameUser = gameTeams.find(
    (team) => team.id === initialGameTeamId,
  );
  const [selectedGameTeam, setSelectedGameTeam] = useState<
    (typeof gameTeams)[number] | undefined
  >(gameTeamFromGameUser);

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
        <GameTeamSelection
          gameTeams={gameTeams}
          initialGameTeamId={initialGameTeamId}
          onChange={(gameTeamId) => {
            setSelectedGameTeam(
              gameTeams.find((team) => team.id === gameTeamId),
            );
          }}
        />
      )}
      {selectedGameTeam && (
        <Button
          onClick={() => buzzInMutation.mutate()}
          disabled={buzzInMutation.isPending}
          className="h-40 w-full bg-blue-500 text-white hover:bg-blue-600"
        >
          Buzzer
        </Button>
      )}
    </div>
  );
}
