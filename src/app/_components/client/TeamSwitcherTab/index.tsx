"use client";

import { GameFormat } from "@prisma/client";
import type { Game, GameTeam } from "@prisma/client";

import { GameTeamSelection } from "@/app/_components/client/GameTeamSelection";

import type { GameSettings } from "@/types";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Notice } from "@/app/_components/ui/page";

export function TeamSwitcherTab({
  game,
  gameTeams: initialGameTeams,
  initialGameTeamId,
}: {
  game: Pick<Game, "id" | "format" | "settings">;
  gameTeams: Pick<GameTeam, "id" | "name" | "index">[];
  initialGameTeamId: GameTeam["id"] | undefined | null;
}) {
  const currentGameState = useLiveGameState();

  // Only show team switcher for team format games
  if (game.format !== GameFormat.team) {
    return null;
  }

  const initialGameSettings = game.settings as GameSettings;
  const currentGameSettings = currentGameState.data?.game
    .settings as GameSettings;

  const settings = currentGameSettings ?? initialGameSettings;
  const gameTeams = currentGameState.data?.gameTeams ?? initialGameTeams;
  const isTeamsFrozen = !!settings?.freezeTeams;

  const currentAssignment =
    currentGameState.data?.game.teamAssignment ?? undefined;
  if (currentAssignment === "staff") {
    return (
      <Notice tone="info">
        <strong>Your host assigns teams.</strong> Ask them if you need to be on
        a different team.
      </Notice>
    );
  }

  if (isTeamsFrozen) {
    return (
      <Notice tone="warning">
        <strong>Teams are locked for now.</strong> Your host has turned off team
        switching. Ask them if you need to move.
      </Notice>
    );
  }

  return (
    <GameTeamSelection
      gameTeams={gameTeams}
      initialGameTeamId={initialGameTeamId}
    />
  );
}
