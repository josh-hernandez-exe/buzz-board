"use client";

import { BuzzerState } from "@prisma/client";

import { cn } from "@/app/_lib/utils";
import { usePublicLiveGameState } from "@/app/_components/client/LiveGameState";
import type { GameTeamFromPublicState } from "@/types";

/**
 * A team on the audience display: name, a score readable from across the
 * room, and its buzzer state in words as well as colour.
 */
export function GamePublicScoreboardTeamCard({
  gameTeam: initialGameTeam,
  queueSpot,
  leading = false,
}: {
  gameId?: string;
  gameTeam: GameTeamFromPublicState;
  /** Queue mode: this team's place in line while waiting. */
  queueSpot?: number;
  leading?: boolean;
}) {
  const { data } = usePublicLiveGameState();
  const gameTeam =
    data?.gameTeams.find((team) => team.id === initialGameTeam.id) ??
    initialGameTeam;
  const selected = gameTeam.buzzerState === BuzzerState.selected;
  const rejected = gameTeam.buzzerState === BuzzerState.rejected;
  const status = selected
    ? "Buzzed in!"
    : rejected
      ? "✕ Out this question"
      : queueSpot
        ? `#${queueSpot} in line`
        : null;

  return (
    <article
      data-testid="display-team"
      data-buzzer-state={gameTeam.buzzerState}
      className={cn(
        "flex flex-col gap-1 rounded-2xl border-2 p-4 transition-colors",
        selected
          ? "bg-stage-highlight border-stage-highlight text-accent-foreground shadow-lg"
          : rejected
            ? "bg-surface-sunken border-stage-strike text-stage-muted"
            : "bg-stage-tile border-stage-tile-border text-stage-foreground",
      )}
    >
      <h3 className="flex items-center gap-2 text-xl font-bold">
        <span className="min-w-0 flex-1 truncate">{gameTeam.name}</span>
        {leading && (
          <span aria-label="leading" title="Leading">
            ★
          </span>
        )}
      </h3>
      <p
        data-testid="display-team-score"
        className="font-display text-6xl leading-none font-extrabold tabular-nums"
      >
        {gameTeam.score}
      </p>
      <p className="flex items-center justify-between gap-2 text-sm">
        <span className={selected ? undefined : "text-stage-muted"}>
          {gameTeam.numPlayers}{" "}
          {gameTeam.numPlayers === 1 ? "player" : "players"}
        </span>
        {status && <span className="font-bold">{status}</span>}
      </p>
    </article>
  );
}
