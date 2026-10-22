"use client";

import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { MediaBlock } from "@/app/_components/client/MediaBlock";
import { cn } from "@/app/_lib/utils";
import type { PublicGridView } from "@/utils/categoryGrid/projection";

type TeamNames = Record<string, string>;

/**
 * The grid as everyone sees it: categories, tiles with their values, and
 * the open clue in large type. `hostAnswer` (host desk only) shows the
 * answer before it's revealed, dimmed, for reading.
 */
export function CategoryGridBoard({
  view,
  names,
  size = "normal",
  hostAnswer,
  onPick,
}: {
  view: PublicGridView;
  names: TeamNames;
  size?: "normal" | "large";
  hostAnswer?: string;
  /** Host desk: choose a tile. */
  onPick?: (key: string) => void;
}) {
  const large = size === "large";
  const name = (id: string | null) => (id ? (names[id] ?? "A team") : null);
  const clue = view.clue;
  const picker = name(view.selector);

  return (
    <section
      aria-label="Category Grid"
      data-testid="grid-board"
      className="stage bg-stage text-stage-foreground border-stage-tile-border/40 flex flex-col gap-3 rounded-2xl border p-3 shadow-lg sm:p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={cn("font-extrabold", large ? "text-4xl" : "text-lg")}>
          {view.title}
        </h2>
        <p
          role="status"
          data-testid="grid-status"
          className={cn("text-stage-muted", large ? "text-2xl" : "text-sm")}
        >
          {view.finished
            ? "That's the end of the grid!"
            : view.status === "ended"
              ? "Back to the buzzer"
              : clue
                ? clue.phase === "answered"
                  ? clue.winner
                    ? `${name(clue.winner)} got it!`
                    : "Nobody got it"
                  : "Buzz in to answer!"
                : picker
                  ? `${picker} picks next`
                  : "Pick a clue"}
        </p>
      </header>

      {clue ? (
        <div
          data-testid="grid-clue"
          className="bg-stage-tile border-stage-tile-border flex flex-col items-center gap-3 rounded-xl border-2 p-4 text-center sm:p-6"
        >
          <p
            className={cn(
              "text-stage-highlight font-bold tracking-wide uppercase",
              large ? "text-2xl" : "text-sm",
            )}
          >
            {clue.category} · {clue.label}
          </p>
          <p
            data-testid="grid-prompt"
            className={cn(
              "font-display max-w-4xl font-extrabold text-balance",
              large ? "text-5xl leading-tight" : "text-2xl",
            )}
          >
            {clue.prompt}
          </p>
          <MediaBlock media={clue.promptMedia} large={large} />
          {clue.answer !== null ? (
            <p
              data-testid="grid-answer"
              className={cn(
                "bg-stage-highlight text-accent-foreground rounded-lg px-4 py-2 font-extrabold",
                large ? "text-4xl" : "text-xl",
              )}
            >
              {clue.answer}
            </p>
          ) : (
            hostAnswer && (
              <p className="text-stage-muted italic">
                Answer (hidden from players): {hostAnswer}
              </p>
            )
          )}
          {clue.answer !== null && (
            <MediaBlock media={clue.answerMedia} large={large} />
          )}
          {clue.attempts.length > 0 && (
            <ul
              aria-label="Answers given"
              className={cn(
                "flex flex-wrap justify-center gap-2",
                large ? "text-2xl" : "text-sm",
              )}
            >
              {clue.attempts.map((a, i) => (
                <li
                  key={i}
                  className={cn(
                    "rounded-full border-2 px-3 py-0.5 font-bold",
                    a.correct
                      ? "border-stage-highlight text-stage-highlight"
                      : "border-stage-strike text-stage-muted",
                  )}
                >
                  {a.correct ? "✓" : "✕"} {name(a.team)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div
          role="grid"
          aria-label="Clues"
          className="grid gap-1.5 sm:gap-2"
          style={{
            gridTemplateColumns: `repeat(${view.columns.length}, minmax(0, 1fr))`,
          }}
        >
          <div role="row" className="contents">
            {view.columns.map((c, ci) => (
              <div
                key={ci}
                role="columnheader"
                className={cn(
                  "flex items-center justify-center rounded-md px-1 py-2 text-center font-extrabold break-words uppercase",
                  large ? "text-xl" : "text-[0.65rem] leading-tight sm:text-xs",
                )}
              >
                {c.title}
              </div>
            ))}
          </div>
          {Array.from(
            { length: view.columns[0]?.tiles.length ?? 0 },
            (_r, ri) => (
              <div key={ri} role="row" className="contents">
                {view.columns.map((c) => {
                  const t = c.tiles[ri]!;
                  const open = t.state === "available";
                  const content = open ? (
                    <span className="font-display font-extrabold tabular-nums">
                      {t.label}
                    </span>
                  ) : (
                    <span className="text-stage-muted text-[0.65rem] sm:text-xs">
                      {t.state === "correct"
                        ? `✓ ${name(t.team) ?? ""}`
                        : t.state === "void"
                          ? "—"
                          : "✕"}
                    </span>
                  );
                  const cls = cn(
                    "flex min-h-11 items-center justify-center rounded-md border-2 p-1 text-center",
                    large
                      ? "min-h-20 text-4xl"
                      : "text-lg sm:min-h-14 sm:text-2xl",
                    open
                      ? "bg-stage-tile border-stage-tile-border text-stage-highlight"
                      : "border-stage-tile-border/30 bg-transparent",
                  );
                  return onPick && open ? (
                    <button
                      key={t.key}
                      role="gridcell"
                      type="button"
                      aria-label={`${c.title} for ${t.label}`}
                      className={cn(
                        cls,
                        "hover:bg-stage-tile-revealed cursor-pointer",
                      )}
                      onClick={() => onPick(t.key)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div
                      key={t.key}
                      role="gridcell"
                      aria-label={`${c.title} for ${t.label}${open ? "" : ": played"}`}
                      className={cls}
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

/** The grid on a player page, from the page's live game state. */
export function LiveCategoryGrid() {
  const { data } = useLiveGameState();
  if (data?.mode?.kind !== "categoryGrid" || data.mode.status !== "running") {
    return null;
  }
  const names = Object.fromEntries(data.gameTeams.map((t) => [t.id, t.name]));
  return <CategoryGridBoard view={data.mode} names={names} />;
}
