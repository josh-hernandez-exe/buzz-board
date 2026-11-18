"use client";

import { GameFormat } from "@prisma/client";
import type { Game, GameTeam } from "@prisma/client";

import { GameTeamSelection } from "@/app/_components/client/GameTeamSelection";

import type { GameSettings } from "@/types";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Notice } from "@/app/_components/ui/page";
import { Button } from "@/app/_components/ui/button";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { api } from "@/trpc/react";

/**
 * Captains-only games: who captains the player's team, and for the captain,
 * a way to hand the role to a teammate.
 */
export function TeamCaptainCard({ gameUserId }: { gameUserId: string }) {
  const { data } = useLiveGameState();
  const hand = api.gameUser.handCaptaincy.useMutation();
  if (data?.game.format !== GameFormat.team || !data.game.captainsOnly) {
    return null;
  }
  const team = data.gameTeams.find(
    (t) => t.id === data.gameUsers[gameUserId]?.gameTeamId,
  );
  if (!team) return null;
  const isCaptain = team.captainId === gameUserId;
  const members = team.gameUsers
    .map((id) => data.gameUsers[id])
    .filter((u) => u !== undefined)
    .sort((a, b) => a.index - b.index);

  return (
    <section
      aria-label="Team captain"
      data-testid="team-captain"
      className="bg-surface border-border flex flex-col gap-2 rounded-xl border p-4 text-sm shadow-sm"
    >
      <h2 className="font-semibold">Team captain</h2>
      <p className="text-muted-foreground">
        In this game only the captain buzzes and saves answers for {team.name}.
        Everyone else can still see the team&apos;s answers and chat.
      </p>
      <ul className="flex flex-col gap-1">
        {members.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              {u.id === team.captainId && (
                <span aria-label="Captain" title="Captain">
                  ★{" "}
                </span>
              )}
              {u.name}
              {u.id === gameUserId && (
                <span className="text-muted-foreground"> (you)</span>
              )}
            </span>
            {isCaptain && u.id !== gameUserId && (
              <Button
                size="sm"
                variant="secondary"
                disabled={hand.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Make ${u.name} the captain? They'll buzz and answer for the team instead of you.`,
                    )
                  ) {
                    hand.mutate({ gameUserId: u.id });
                  }
                }}
              >
                Make captain
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!isCaptain && (
        <p className="text-muted-foreground text-xs">
          The captain or your host can change who captains the team.
        </p>
      )}
      <ErrorNotice error={hand.error} />
    </section>
  );
}

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
