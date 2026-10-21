"use client";

import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { cn } from "@/app/_lib/utils";
import { ordinal, standings, winnerLine } from "@/utils/standings";

/**
 * The end of the game: the winner in large type and every team's place.
 * `stage` uses the display's game-show colours.
 */
export function FinalStandings({
  teams,
  size = "normal",
  highlight,
}: {
  teams: { id: string; name: string; score: number }[];
  size?: "normal" | "large";
  /** The viewer's own team. */
  highlight?: string | null;
}) {
  const table = standings(teams);
  const line = winnerLine(table);
  const large = size === "large";
  const mine = table.find((t) => t.id === highlight);
  if (!line) return null;
  return (
    <section
      aria-label="Final results"
      data-testid="final-standings"
      className="stage bg-stage text-stage-foreground border-stage-tile-border/40 flex flex-col items-center gap-4 rounded-2xl border p-4 text-center shadow-lg sm:p-6"
    >
      <p
        className={cn(
          "text-stage-highlight font-bold tracking-wide uppercase",
          large ? "text-2xl" : "text-sm",
        )}
      >
        Final results
      </p>
      <h2
        data-testid="final-winner"
        className={cn(
          "font-display font-extrabold text-balance",
          large ? "text-6xl" : "text-3xl",
        )}
      >
        🏆 {line}
      </h2>
      {mine && (
        <p className={large ? "text-2xl" : "text-lg"}>
          {mine.place === 1
            ? mine.tied
              ? "You tied for first!"
              : "You won!"
            : `You finished ${mine.tied ? "joint " : ""}${ordinal(mine.place)}.`}
        </p>
      )}
      <ol
        aria-label="Places"
        className={cn(
          "flex w-full max-w-2xl flex-col gap-1.5 text-left",
          large ? "text-3xl" : "text-base",
        )}
      >
        {table.map((t) => (
          <li
            key={t.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border-2 px-3 py-1.5",
              t.place === 1
                ? "bg-stage-highlight border-stage-highlight text-accent-foreground"
                : "bg-stage-tile border-stage-tile-border",
              t.id === highlight &&
                t.place !== 1 &&
                "ring-stage-highlight ring-2",
            )}
          >
            <span className="w-14 font-bold tabular-nums">
              {t.tied ? "=" : ""}
              {ordinal(t.place)}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {t.name}
            </span>
            <span className="font-display font-extrabold tabular-nums">
              {t.score}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Final results on a member page once the game has finished. */
export function LiveFinalStandings({ gameUserId }: { gameUserId?: string }) {
  const { data } = useLiveGameState();
  if (data?.game.status !== "finished") return null;
  const teamId = gameUserId ? data.gameUsers[gameUserId]?.gameTeamId : null;
  return <FinalStandings teams={data.gameTeams} highlight={teamId} />;
}
