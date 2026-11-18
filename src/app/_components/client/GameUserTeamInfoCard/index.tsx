"use client";

import { env } from "@/env";

import { Notice, Panel } from "@/app/_components/ui/page";

import { api } from "@/trpc/react";

import type {
  GameUserFromPrivateState,
  GameTeamFromPrivateState,
  GameUserFromTeamWithRelations,
} from "@/types";

import { GameTeamUserTable } from "./GameTeamUserTable";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";

export function GameUserTeamInfoCard({
  gameTeam: initialGameTeam,
  gameUsers: initialGameUsers,
}: {
  gameTeam?: GameTeamFromPrivateState;
  gameUsers?: GameUserFromPrivateState[];
}) {
  const gameTeamInfo = api.gameUser.getSelfTeamInfo.useQuery();
  const gameState = useLiveGameState();

  const gameTeamFromState = gameState.data?.gameTeams.find(
    (team) => team.id === gameTeamInfo.data?.id,
  );

  const gameTeam = gameTeamFromState ?? initialGameTeam;

  let gameUsers: (GameUserFromPrivateState | GameUserFromTeamWithRelations)[] =
    [];

  if (gameTeamFromState && gameState.data) {
    gameUsers = gameTeamFromState.gameUsers
      .map((userId) => gameState?.data?.gameUsers[userId])
      .filter(Boolean) as GameUserFromPrivateState[];
  } else if (gameTeamInfo.data) {
    gameUsers = gameTeamInfo.data.gameUsers;
  } else if (initialGameUsers) {
    gameUsers = initialGameUsers;
  }

  if (
    !gameTeam &&
    (gameTeamInfo.isLoading || gameState.status === "connecting")
  ) {
    // If both the query and subscription data are not available, we show a loading state.
    return null;
  } else if (!gameTeam) {
    // If no team is assigned, we show a message indicating that the user is not part of any team.
    return (
      <Notice tone="warning">
        <strong>No team yet.</strong> Choose one on the <strong>Team</strong>{" "}
        tab, or wait for your host to put you on a team.
      </Notice>
    );
  }

  gameUsers.sort((a, b) => a.index - b.index);

  return (
    <Panel
      title="Your team"
      description={`${gameTeam?.name} · ${gameUsers.length} ${gameUsers.length === 1 ? "player" : "players"}`}
    >
      {env.NEXT_PUBLIC_SHOW_DEBUG_INFO && (
        <p className="text-muted-foreground text-xs">Team ID: {gameTeam?.id}</p>
      )}
      <GameTeamUserTable
        data={gameUsers.map((gameUser) => {
          const image =
            "user" in gameUser ? gameUser.user?.image : gameUser.image;
          return {
            id: gameUser.id,
            name: gameUser.name,
            index: gameUser.index,
            image: image ?? null,
          };
        })}
      />
    </Panel>
  );
}
