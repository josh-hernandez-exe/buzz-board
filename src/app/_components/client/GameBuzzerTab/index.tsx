"use client";

import { GameFormat } from "@prisma/client";
import type { Game, GameTeam } from "@prisma/client";

import { Button } from "@/app/_components/ui/button";
import { api } from "@/trpc/react";

import { logger } from "@/logger";

export function GameBuzzerTab({
  game,
  gameTeam: initialGameTeam,
}: {
  game: Pick<Game, "id" | "format">;
  gameTeam: Pick<GameTeam, "id" | "name" | "index"> | undefined | null;
}) {
  const gameTeamInfo = api.gameUser.getSelfTeamInfo.useQuery();
  const selectedGameTeam = gameTeamInfo.data ?? initialGameTeam;

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

  return (
    <div>
      {selectedGameTeam && (
        <Button
          onClick={() => buzzInMutation.mutate()}
          disabled={buzzInMutation.isPending}
          className="h-40 w-full bg-blue-500 text-white hover:bg-blue-600"
        >
          Buzzer
        </Button>
      )}
      {!selectedGameTeam && game.format === GameFormat.team && (
        <div className="flex flex-col items-center justify-center p-8">
          <div className="rounded-lg border border-amber-500 bg-amber-50 p-6 text-center">
            <h3 className="mb-2 text-lg font-medium text-amber-800">
              Join a team to buzz in
            </h3>
            <p className="text-amber-700">
              Switch to the Team Switcher tab to select your team.
            </p>
          </div>
        </div>
      )}
      {!selectedGameTeam && game.format === GameFormat.individual && (
        <div className="flex flex-col items-center justify-center p-8">
          <div className="rounded-lg border border-red-500 bg-red-50 p-6 text-center">
            <h3 className="mb-2 text-lg font-medium text-red-800">
              No team assigned
            </h3>
            <p className="text-red-700">
              Please contact the game administrator.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
