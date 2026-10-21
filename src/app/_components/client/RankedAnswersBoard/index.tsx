"use client";

import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import type {
  PublicBoard,
  PublicModeView,
} from "@/utils/rankedAnswers/projection";

type TeamNames = Record<string, string>;

const list = (ids: string[], names: TeamNames) =>
  ids.map((id) => names[id] ?? "a team").join(" and ");

/** One line saying what's happening on the board right now. */
export function boardStatus(board: PublicBoard, names: TeamNames): string {
  const name = (id: string | null) => (id ? (names[id] ?? "A team") : "A team");
  switch (board.phase) {
    case "faceOff":
      return `Face-off: ${list(board.faceOffTeams, names).replace(" and ", " vs ")}`;
    case "playOrPass":
      return `${name(board.faceOffWinner)} won the face-off: play or pass?`;
    case "control":
      return `${name(board.control)} is playing`;
    case "steal": {
      const stealers = board.teams.filter((t) => t !== board.control);
      return stealers.length === 1
        ? `${name(stealers[0]!)} can steal ${board.bank} points!`
        : `Steal! Every other team gets one answer for ${board.bank} points`;
    }
    case "turns":
      return `${name(board.currentTeam)}'s turn (${board.turn + 1} of ${board.maxTurns})`;
    case "allPlay":
      return `Round ${board.round + 1} of ${board.maxRounds}: captains, give your team's answer`;
    case "closed":
      if (board.bankWinners.length > 0) {
        return `${list(board.bankWinners, names)} ${board.bankWinners.length === 1 ? "takes" : "take"} the bank: ${board.bank} points`;
      }
      return "Board over";
  }
}

/**
 * The board as everyone sees it: hidden answers show only their number.
 * `hostAnswers` (host desk only) shows hidden answers dimmed, for reading.
 */
export function RankedAnswersBoard({
  view,
  names,
  hostAnswers,
  size = "normal",
}: {
  view: PublicModeView;
  names: TeamNames;
  hostAnswers?: { text: string; points: number }[];
  size?: "normal" | "large";
}) {
  const board = view.board;
  const large = size === "large";
  if (!board) {
    return (
      <section
        aria-label="Ranked Answers board"
        className="stage bg-stage text-stage-foreground rounded-2xl p-6 text-center shadow-lg"
      >
        <p className={large ? "text-3xl font-bold" : "text-lg font-semibold"}>
          {view.finished
            ? "That's the last board!"
            : view.status === "ended"
              ? "Back to the buzzer"
              : "Get ready for the first board"}
        </p>
      </section>
    );
  }
  const half = Math.ceil(board.rows.length / 2);
  const columns = [board.rows.slice(0, half), board.rows.slice(half)];

  return (
    <section
      aria-label="Ranked Answers board"
      data-testid="ranked-board"
      className="stage bg-stage text-stage-foreground border-stage-tile-border/40 flex flex-col gap-3 rounded-2xl border p-4 shadow-lg"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          data-testid="ranked-prompt"
          className={`font-extrabold ${large ? "text-5xl" : "text-xl"}`}
        >
          {board.prompt}
        </h2>
        <span className="text-stage-muted text-sm">
          {board.role === "practice"
            ? "Practice board: no points"
            : board.role === "spare"
              ? "Tie-break board"
              : `Board ${view.mainBoardsStarted} of ${view.mainBoardsTotal}`}
          {board.multiplier > 1 && ` · ${board.multiplier}× points`}
        </span>
      </header>

      <p
        role="status"
        data-testid="ranked-status"
        className={`font-display text-stage-highlight text-center font-extrabold ${large ? "text-3xl" : "text-lg"}`}
      >
        {boardStatus(board, names)}
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {columns.map((rows, c) => (
          <ol key={c} className="flex flex-col gap-2" start={c * half + 1}>
            {rows.map((row) => {
              const shown = row.text !== null;
              const host = hostAnswers?.[row.rank - 1];
              return (
                <li
                  key={row.rank}
                  data-testid="ranked-row"
                  data-shown={shown}
                  className={`flex items-center justify-between gap-2 rounded-md border-2 px-3 ${
                    large ? "py-3 text-2xl" : "py-2"
                  } ${
                    shown
                      ? row.leftover
                        ? "border-stage-tile-border bg-stage-tile text-stage-muted"
                        : "border-stage-highlight bg-stage-tile-revealed font-bold"
                      : "border-stage-tile-border bg-stage-tile"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="bg-stage flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                      {row.rank}
                    </span>
                    {shown ? (
                      <span>{row.text}</span>
                    ) : host ? (
                      <span className="text-stage-muted italic">
                        {host.text}
                      </span>
                    ) : (
                      <span className="sr-only">Hidden answer</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {row.teams.length > 0 && (
                      <span className="text-stage-muted text-xs font-normal">
                        {list(row.teams, names)}
                      </span>
                    )}
                    <span className="min-w-8 text-right font-mono">
                      {shown ? (
                        row.points
                      ) : host ? (
                        <span className="text-stage-muted">{host.points}</span>
                      ) : (
                        ""
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        ))}
      </div>

      {(board.phase === "control" ||
        board.phase === "steal" ||
        board.bank > 0) && (
        <div className="flex items-center justify-between gap-4">
          <span
            aria-label={`${board.strikes} of ${board.maxStrikes} strikes`}
            className="flex gap-1"
          >
            {Array.from({ length: board.maxStrikes }, (_, i) => (
              <span
                key={i}
                className={`font-black ${large ? "text-5xl" : "text-2xl"} ${
                  i < board.strikes
                    ? "text-stage-strike"
                    : "text-stage-muted/25"
                }`}
              >
                ✕
              </span>
            ))}
          </span>
          <span className={`font-bold ${large ? "text-3xl" : "text-lg"}`}>
            Bank: <span data-testid="ranked-bank">{board.bank}</span>
          </span>
        </div>
      )}
    </section>
  );
}

/** The board for a player page, from the page's live game state. */
export function LiveRankedAnswersBoard() {
  const { data } = useLiveGameState();
  if (data?.mode?.status !== "running") return null;
  const names = Object.fromEntries(data.gameTeams.map((t) => [t.id, t.name]));
  return <RankedAnswersBoard view={data.mode} names={names} />;
}
