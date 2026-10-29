/**
 * What players and the audience see of a Ranked Answers game: hidden rows
 * have no text and no points, so nothing about an unrevealed answer leaves
 * the server. Pure; the host's full view is a separate staff-only query.
 */
import { type Content, LIMITS, pointsFor, resolveRules } from "./content";
import {
  currentTurnTeam,
  stealersOf,
  type EngineState,
  type BoardState,
  type Phase,
} from "./engine";

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
  /** Steal phase: who may steal, and whether a steal takes the bank. */
  stealers: string[];
  stealTakesBank: boolean;
  /** Pass-along: a team keeps the turn while it finds answers. */
  keepTurnOnHit: boolean;
  /** Buzz race: teams sitting out right now. */
  lockedOut: string[];
  /** Face-off styles: rows build a bank, or score at once. */
  usesBank: boolean;
  /** The host voided the board: no points from it count. */
  voided: boolean;
  /** Turn styles: why the board closed on its own (null: the host closed it, or another style). */
  endedBy: BoardState["endedBy"] | null;
};

export type PublicModeView = {
  kind: "rankedAnswers";
  status: "running" | "ended";
  playStyle: Content["rules"]["playStyle"];
  /** The first team to reach it wins (informational), or null. */
  targetScore: number | null;
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
  const opts = resolveRules(rules);
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
      currentTeam: currentTurnTeam(b),
      turn: b.turn,
      maxTurns: b.order.length * rules.turnCycles,
      round: b.round,
      maxRounds: rules.allPlayRounds,
      bankWinners: b.bankWinners,
      awarded: b.awarded,
      stealers: b.phase === "steal" ? stealersOf(rules, b) : [],
      stealTakesBank:
        opts.scoring === "bank" && opts.stealReward === "bankPlusRow",
      keepTurnOnHit: rules.playStyle === "passAlong",
      lockedOut: b.lockedOut ?? [],
      usesBank: opts.scoring === "bank",
      voided: b.voided ?? false,
      endedBy: b.endedBy ?? null,
    };
  }
  return {
    kind: "rankedAnswers",
    status,
    playStyle: rules.playStyle,
    targetScore: opts.targetScore,
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
