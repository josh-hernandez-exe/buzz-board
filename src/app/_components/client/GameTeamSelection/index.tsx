"use client";

import type { GameTeam } from "@prisma/client";

import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import { Panel } from "@/app/_components/ui/page";
import { cn } from "@/app/_lib/utils";
import { api } from "@/trpc/react";

/**
 * Every team with who's on it; one tap joins a team. The player's current
 * team is marked and can't be "joined" again.
 */
export function GameTeamSelection({
  initialGameTeamId,
  gameTeams: initialGameTeams,
  onChange,
}: {
  initialGameTeamId: GameTeam["id"] | undefined | null;
  gameTeams: Array<Pick<GameTeam, "id" | "name" | "index">>;
  onChange?: (gameTeamId: GameTeam["id"]) => void;
}) {
  const utils = api.useUtils();
  const self = api.gameUser.getSelfInfo.useQuery();
  const { data } = useLiveGameState();
  const changeTeam = api.gameUser.changeTeams.useMutation({
    onSuccess: (updated) => {
      void utils.gameUser.getSelfInfo.invalidate();
      void utils.gameUser.getSelfTeamInfo.invalidate();
      onChange?.(updated.gameTeamId);
    },
  });

  const selfId = self.data?.id;
  const currentTeamId =
    (selfId ? data?.gameUsers[selfId]?.gameTeamId : undefined) ??
    self.data?.gameTeamId ??
    initialGameTeamId;
  const teams = [...(data?.gameTeams ?? initialGameTeams)].sort(
    (a, b) => a.index - b.index,
  );
  const membersOf = (teamId: string) =>
    Object.values(data?.gameUsers ?? {})
      .filter((u) => u.gameTeamId === teamId)
      .map((u) => u.name);
  const current = teams.find((t) => t.id === currentTeamId);

  if (teams.length === 0) {
    return (
      <Panel>
        <p className="text-muted-foreground">
          There are no teams yet. Your host will add some.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title={current ? `You're on ${current.name}` : "Pick a team"}
      description={
        current
          ? "Tap another team to switch."
          : "Tap a team to join it. You can switch later while the buzzer is closed."
      }
    >
      <ul className="flex flex-col gap-2">
        {teams.map((team) => {
          const mine = team.id === currentTeamId;
          const members = membersOf(team.id);
          const pending =
            changeTeam.isPending &&
            changeTeam.variables?.gameTeamId === team.id;
          return (
            <li
              key={team.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border-2 p-3",
                mine ? "border-success bg-success-soft" : "border-border",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="font-bold break-words">{team.name}</p>
                <p className="text-muted-foreground text-sm break-words">
                  {members.length === 0 ? "No players yet" : members.join(", ")}
                </p>
              </div>
              {mine ? (
                <span className="text-sm font-bold">Your team</span>
              ) : (
                <Button
                  variant="secondary"
                  disabled={changeTeam.isPending}
                  aria-label={`Join ${team.name}`}
                  onClick={() => changeTeam.mutate({ gameTeamId: team.id })}
                >
                  {pending ? "Joining…" : "Join"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorNotice error={changeTeam.error} />
    </Panel>
  );
}
