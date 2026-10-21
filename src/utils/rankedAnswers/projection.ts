/**
 * What players and the audience see of a Ranked Answers game: hidden rows
 * have no text and no points, so nothing about an unrevealed answer leaves
 * the server. Pure; the host's full view is a separate staff-only query.
 */
import { type Content, LIMITS, pointsFor } from "./content";
import { type EngineState, type Phase } from "./engine";

export type PublicRow = {
  rank: number;
  /** null while hidden. */
  text: string | null;
  points: number | null;
  /** Team IDs credited with finding it. */
  teams: string[];
  /** Revealed when the board closed, or shown by a correction, for 0. */
  leftover: boolean;
};

export type PublicBoard = {
  id: string;
  role: "main" | "practice" | "spare";
  prompt: string;
  multiplier: number;
  rows: PublicRow[];
  phase: Phase;
  teams: string[];
  strikes: number;
  maxStrikes: number;
  bank: number;
  faceOffTeams: string[];
  faceOffWinner: string | null;
  control: string | null;
  /** Round robin: whose turn it is. */
  currentTeam: string | null;
  turn: number;
  maxTurns: number;
  round: number;
  maxRounds: number;
  bankWinners: string[];
  awarded: Record<string, number>;
};

export type PublicModeView = {
  kind: "rankedAnswers";
  status: "running" | "ended";
  playStyle: Content["rules"]["playStyle"];
  mainBoardsTotal: number;
  mainBoardsStarted: number;
  board: PublicBoard | null;
  finished: boolean;
};

export function projectPublic(
  content: Content,
  state: EngineState,
  status: "running" | "ended",
): PublicModeView {
  const { rules } = content;
  const b = state.board;
  const board = b ? content.boards.find((x) => x.id === b.boardId) : undefined;
  let view: PublicBoard | null = null;
  if (b && board) {
    const scoring = board.role !== "practice";
    view = {
      id: board.id,
      role: board.role,
      prompt: board.prompt,
      multiplier: board.multiplier ?? rules.multiplier,
      rows: board.answers.slice(0, LIMITS.maxAnswers).map((a, i) => {
        const shown = b.revealed.find((r) => r.rank === i + 1);
        return {
          rank: i + 1,
          text: shown ? a.text : null,
          points: shown ? (scoring ? pointsFor(rules, board, i + 1) : 0) : null,
          teams: shown?.teams ?? [],
          leftover: shown?.leftover ?? false,
        };
      }),
      phase: b.phase,
      teams: b.teams,
      strikes: b.strikes,
      maxStrikes: rules.strikes,
      bank: b.bank,
      faceOffTeams: b.faceOffTeams,
      faceOffWinner: b.faceOffWinner,
      control: b.control,
      currentTeam:
        b.phase === "turns" ? (b.order[b.turn % b.order.length] ?? null) : null,
      turn: b.turn,
      maxTurns: b.order.length * rules.turnCycles,
      round: b.round,
      maxRounds: rules.allPlayRounds,
      bankWinners: b.bankWinners,
      awarded: b.awarded,
    };
  }
  return {
    kind: "rankedAnswers",
    status,
    playStyle: rules.playStyle,
    mainBoardsTotal: content.boards.filter((x) => x.role === "main").length,
    mainBoardsStarted: state.mainStarted,
    board: view,
    finished: state.finished,
  };
}

/** The public view from a stored mode record, or null before it starts. */
export function publicModeView(
  mode: { status: string; content: unknown; state: unknown } | null | undefined,
): PublicModeView | null {
  if (!mode || mode.status === "draft" || !mode.content || !mode.state) {
    return null;
  }
  return projectPublic(
    mode.content as Content,
    mode.state as EngineState,
    mode.status === "ended" ? "ended" : "running",
  );
}
