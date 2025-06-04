"use client";

import { GameFormat } from "@prisma/client";
import type { Game, GameTeam } from "@prisma/client";

import { api } from "@/trpc/react";

import { GameTeamSelection } from "@/app/_components/client/GameTeamSelection";

import type { GameSettings } from "@/types";

export function TeamSwitcherTab({
  game,
  gameTeams: initialGameTeams,
  initialGameTeamId,
}: {
  game: Pick<Game, "id" | "format" | "settings">;
  gameTeams: Pick<GameTeam, "id" | "name" | "index">[];
  initialGameTeamId: GameTeam["id"] | undefined | null;
}) {
  // Only show team switcher for team format games
  if (game.format !== GameFormat.team) {
    return null;
  }
  const currentGameState = api.gameGeneral.gameState.useSubscription();

  const initialGameSettings = game.settings as GameSettings;
  const currentGameSettings = currentGameState.data?.game
    .settings as GameSettings;

  const settings = currentGameSettings ?? initialGameSettings;
  const gameTeams = currentGameState.data?.gameTeams ?? initialGameTeams;
  const isTeamsFrozen = !!settings?.freezeTeams;

  if (isTeamsFrozen) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <div className="rounded-lg border border-yellow-500 bg-yellow-50 p-6 text-center">
          <h3 className="mb-2 text-lg font-medium text-yellow-800">
            Team switching is currently disabled
          </h3>
          <p className="text-yellow-700">
            The game administrator has temporarily frozen team assignments.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <GameTeamSelection
        gameTeams={gameTeams}
        initialGameTeamId={initialGameTeamId}
      />
    </div>
  );
}
