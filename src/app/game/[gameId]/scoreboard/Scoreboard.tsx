"use client";

import { BuzzerState, GameFormat } from "@prisma/client";

import { GameSoundEffects } from "@/app/_components/client/GameSoundEffects";
import { LiveFinalStandings } from "@/app/_components/client/FinalStandings";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { PageHeading } from "@/app/_components/ui/page";
import { cn } from "@/app/_lib/utils";
import { env } from "@/env";
import type { PrivateGameState } from "@/types";
import { STATUS_LABEL } from "@/utils/gameRules";

/** The signed-in scoreboard for players and hosts: scores and who's who. */
export function Scoreboard({
  gameState: initialGameState,
}: {
  gameState: PrivateGameState;
}) {
  const state = useLiveGameState().data ?? initialGameState;
  const { game, gameUsers } = state;
  const individual = game.format === GameFormat.individual;
  const teams = [...state.gameTeams].sort((a, b) =>
    individual ? b.score - a.score : a.index - b.index,
  );
  const best = Math.max(0, ...teams.map((t) => t.score));

  return (
    <div className="flex w-full flex-col gap-4">
      <GameSoundEffects />
      <PageHeading
        title={game.name}
        description={`Scoreboard · ${STATUS_LABEL[game.status]}`}
      />
      <LiveFinalStandings />
      <GameWhoBuzzedIn />
      <ul
        aria-label={individual ? "Players" : "Teams"}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {teams.map((team) => {
          const members = team.gameUsers
            .map((id) => gameUsers[id]?.name)
            .filter((name): name is string => !!name);
          const name = individual ? (members[0] ?? team.name) : team.name;
          const selected = team.buzzerState === BuzzerState.selected;
          const rejected = team.buzzerState === BuzzerState.rejected;
          return (
            <li
              key={team.id}
              className={cn(
                "bg-surface flex flex-col gap-1 rounded-xl border-2 p-4 shadow-sm",
                selected
                  ? "border-success bg-success-soft"
                  : rejected
                    ? "border-destructive/50 bg-destructive-soft"
                    : "border-border",
              )}
            >
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {best > 0 && team.score === best && (
                  <span
                    aria-label="leading"
                    className="text-warning-text"
                    title="Leading"
                  >
                    ★
                  </span>
                )}
              </h2>
              <p className="font-display text-5xl leading-none font-extrabold tabular-nums">
                {team.score}
              </p>
              {(selected || rejected) && (
                <p className="text-sm font-bold">
                  {selected ? "Buzzed in" : "✕ Out this question"}
                </p>
              )}
              {!individual && (
                <p className="text-muted-foreground text-sm break-words">
                  {members.length > 0 ? members.join(", ") : "No players yet"}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {game.status !== "finished" && (
        <p className="text-muted-foreground text-center text-sm">
          Join at {env.NEXT_PUBLIC_QRCODE_BASE_URL.replace(/^https?:\/\//, "")}
          /join with code <strong className="font-mono">{game.code}</strong>
        </p>
      )}
    </div>
  );
}
