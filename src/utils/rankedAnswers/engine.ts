/**
 * The Ranked Answers engine: (state, host action) -> (new state, points to
 * award). Pure and deterministic, so the server runs it inside the same
 * transaction that writes scores, and tests can replay whole boards.
 *
 * The host judges every answer (spoken, or posted in team chat) and records
 * the outcome; the engine applies the rules. Rules are documented in
 * docs/pr13-ranked-answers-event-spec.md.
 */
import { err, ok, type Result } from "neverthrow";

import { pointsFor, type Board, type Content } from "./content";

export type Phase =
  | "faceOff"
  | "playOrPass"
  | "control"
  | "steal"
  | "turns"
  | "allPlay"
  | "closed";

export type RevealedRow = {
  rank: number;
  /** Teams credited with finding it (none for leftovers and bank rows). */
  teams: string[];
  points: number;
  /** Shown when the board closed, for 0 points. */
  leftover: boolean;
};

export type BoardState = {
  boardId: string;
  /** Teams playing this board (all teams, or the tied teams for a spare). */
  teams: string[];
  phase: Phase;
  revealed: RevealedRow[];
  strikes: number;
  bank: number;
  /** Face-off styles: the two teams facing off, and the winner. */
  faceOffTeams: string[];
  faceOffWinner: string | null;
  control: string | null;
  /** Round robin: turn order and turns used. All-play: rounds used. */
  order: string[];
  turn: number;
  round: number;
  /** Points each team earned on this board. */
  awarded: Record<string, number>;
  bankWinners: string[];
};

export type EngineState = {
  /** All teams in their frozen order. */
  teams: string[];
  board: BoardState | null;
  boardsPlayed: string[];
  /** Main boards started so far: drives rotation and face-off pairs. */
  mainStarted: number;
  finished: boolean;
};

export type FaceOffAnswer = { team: string; answerId: string | null };

export type Action =
  | { type: "startBoard"; boardId: string; teams?: string[] }
  /** Buzzer face-off: in buzz order. Secret: both answers. */
  | { type: "faceOff"; answers: FaceOffAnswer[] }
  | { type: "playOrPass"; play: boolean }
  /** The playing team's answer (face-off styles) or the current team's turn (round robin). null is a miss/strike. */
  | { type: "answer"; answerId: string | null }
  | { type: "steal"; answers: Record<string, string | null> }
  | { type: "allPlayRound"; answers: Record<string, string | null> }
  /** Host closes the board early, for example for time. */
  | { type: "closeBoard" }
  | { type: "revealRemaining" }
  | { type: "finish" };

export type EngineError =
  | { kind: "wrongPhase"; phase: Phase | "noBoard" | "finished" }
  | { kind: "unknownBoard" }
  | { kind: "boardAlreadyPlayed" }
  | { kind: "unknownAnswer" }
  | { kind: "unknownTeam"; team: string }
  | { kind: "badTeams" };

export type Step = {
  state: EngineState;
  /** Points to add to each team's score, from this action. */
  scores: Record<string, number>;
};

export function initialState(teams: string[]): EngineState {
  return {
    teams,
    board: null,
    boardsPlayed: [],
    mainStarted: 0,
    finished: false,
  };
}

/** Rotated order: the starting team moves one place per board. */
export function rotate(teams: string[], by: number): string[] {
  const start = by % teams.length;
  return [...teams.slice(start), ...teams.slice(0, start)];
}

/** Face-off pair for the n-th main board (pairs rotate through the teams). */
export function faceOffPair(teams: string[], n: number): string[] {
  if (teams.length <= 2) return [...teams];
  return [teams[(2 * n) % teams.length]!, teams[(2 * n + 1) % teams.length]!];
}

const rankOf = (board: Board, answerId: string | null) => {
  const i = board.answers.findIndex((a) => a.id === answerId);
  return i < 0 ? null : i + 1;
};

const isHidden = (b: BoardState, rank: number) =>
  !b.revealed.some((r) => r.rank === rank);

export function apply(
  content: Content,
  state: EngineState,
  action: Action,
): Result<Step, EngineError> {
  const { rules } = content;
  if (state.finished) return err({ kind: "wrongPhase", phase: "finished" });
  const scores: Record<string, number> = {};
  const award = (b: BoardState, team: string, points: number) => {
    if (points === 0) return;
    b.awarded[team] = (b.awarded[team] ?? 0) + points;
    scores[team] = (scores[team] ?? 0) + points;
  };

  if (action.type === "finish") {
    if (state.board && state.board.phase !== "closed") {
      return err({ kind: "wrongPhase", phase: state.board.phase });
    }
    return ok({ state: { ...state, finished: true }, scores });
  }

  if (action.type === "startBoard") {
    if (state.board && state.board.phase !== "closed") {
      return err({ kind: "wrongPhase", phase: state.board.phase });
    }
    const board = content.boards.find((b) => b.id === action.boardId);
    if (!board) return err({ kind: "unknownBoard" });
    if (state.boardsPlayed.includes(board.id)) {
      return err({ kind: "boardAlreadyPlayed" });
    }
    const teams = action.teams ?? state.teams;
    if (
      teams.length < 2 ||
      teams.some((t) => !state.teams.includes(t)) ||
      new Set(teams).size !== teams.length
    ) {
      return err({ kind: "badTeams" });
    }
    const n = state.mainStarted;
    const faceOffStyle =
      rules.playStyle === "classic" || rules.playStyle === "faceOffLadder";
    const next: BoardState = {
      boardId: board.id,
      teams,
      phase: faceOffStyle
        ? "faceOff"
        : rules.playStyle === "roundRobin"
          ? "turns"
          : "allPlay",
      revealed: [],
      strikes: 0,
      bank: 0,
      faceOffTeams: faceOffStyle ? faceOffPair(teams, n) : [],
      faceOffWinner: null,
      control: null,
      order: rules.playStyle === "roundRobin" ? rotate(teams, n) : [...teams],
      turn: 0,
      round: 0,
      awarded: {},
      bankWinners: [],
    };
    return ok({
      state: {
        ...state,
        board: next,
        boardsPlayed: [...state.boardsPlayed, board.id],
        mainStarted: n + (board.role === "main" ? 1 : 0),
      },
      scores,
    });
  }

  const current = state.board;
  if (!current) return err({ kind: "wrongPhase", phase: "noBoard" });
  const board = content.boards.find((x) => x.id === current.boardId)!;
  // Practice boards play normally but never change scores.
  const scoring = board.role !== "practice";
  const b: BoardState = structuredClone(current);
  const points = (rank: number) =>
    scoring ? pointsFor(rules, board, rank) : 0;
  const allFound = () =>
    b.revealed.filter((r) => !r.leftover).length === board.answers.length;
  const reveal = (rank: number, teams: string[], pts: number) =>
    b.revealed.push({ rank, teams, points: pts, leftover: false });
  const done = (s: BoardState): Result<Step, EngineError> =>
    ok({ state: { ...state, board: s }, scores });
  const needPhase = (...phases: Phase[]) =>
    phases.includes(b.phase)
      ? null
      : err({ kind: "wrongPhase" as const, phase: b.phase });
  const checkTeams = (teams: string[], allowed: string[]) => {
    const bad = teams.find((t) => !allowed.includes(t));
    return bad ? err({ kind: "unknownTeam" as const, team: bad }) : null;
  };
  const checkAnswers = (ids: (string | null)[]) =>
    ids.some((id) => id !== null && rankOf(board, id) === null)
      ? err({ kind: "unknownAnswer" as const })
      : null;
  const resolveBank = (winners: string[]) => {
    b.bankWinners = winners;
    for (const t of winners) award(b, t, b.bank);
    b.phase = "closed";
  };

  switch (action.type) {
    case "faceOff": {
      const wrong =
        needPhase("faceOff") ??
        checkTeams(
          action.answers.map((a) => a.team),
          b.faceOffTeams,
        ) ??
        checkAnswers(action.answers.map((a) => a.answerId));
      if (wrong) return wrong;
      if (action.answers.length === 0 || action.answers.length > 2) {
        return err({ kind: "badTeams" });
      }
      // Rows found in the face-off go into the bank.
      const ranks = action.answers.map((a) => rankOf(board, a.answerId));
      const [first, second] = action.answers;
      const r1 = ranks[0] ?? null;
      const r2 = ranks[1] ?? null;
      let winner: string | null;
      if (rules.faceOffMethod === "buzzer") {
        if (r1 === 1) winner = first!.team;
        else if (!second) winner = r1 !== null ? first!.team : null;
        else if (r1 === null && r2 === null) winner = null;
        else
          winner =
            (r1 ?? Infinity) <= (r2 ?? Infinity) ? first!.team : second.team;
      } else {
        winner =
          second && r1 !== r2
            ? (r1 ?? Infinity) < (r2 ?? Infinity)
              ? first!.team
              : second.team
            : null;
      }
      for (const r of ranks) {
        if (r !== null && isHidden(b, r)) {
          const p = points(r);
          reveal(r, [], p);
          b.bank += p;
        }
      }
      if (winner) {
        b.faceOffWinner = winner;
        b.phase = "playOrPass";
      }
      if (allFound()) resolveBank(winner ? [winner] : []);
      return done(b);
    }
    case "playOrPass": {
      const wrong = needPhase("playOrPass");
      if (wrong) return wrong;
      const winner = b.faceOffWinner!;
      const other = b.faceOffTeams.find((t) => t !== winner)!;
      b.control = action.play ? winner : other;
      b.phase = "control";
      return done(b);
    }
    case "answer": {
      const wrong =
        needPhase("control", "turns") ?? checkAnswers([action.answerId]);
      if (wrong) return wrong;
      const rank = rankOf(board, action.answerId);
      const found = rank !== null && isHidden(b, rank);
      if (b.phase === "control") {
        if (found) {
          const p = points(rank);
          reveal(rank, [], p);
          b.bank += p;
          if (allFound()) resolveBank([b.control!]);
        } else {
          b.strikes++;
          if (b.strikes >= rules.strikes) b.phase = "steal";
        }
        return done(b);
      }
      // Round robin: the current team's one answer.
      const team = b.order[b.turn % b.order.length]!;
      if (found) {
        const p = points(rank);
        reveal(rank, [team], p);
        award(b, team, p);
      }
      b.turn++;
      if (allFound() || b.turn >= b.order.length * rules.turnCycles) {
        b.phase = "closed";
      }
      return done(b);
    }
    case "steal": {
      const stealers = b.teams.filter((t) =>
        rules.playStyle === "classic"
          ? b.faceOffTeams.includes(t) && t !== b.control
          : t !== b.control,
      );
      const wrong =
        needPhase("steal") ??
        checkTeams(Object.keys(action.answers), stealers) ??
        checkAnswers(Object.values(action.answers));
      if (wrong) return wrong;
      const hits = Object.entries(action.answers)
        .map(([team, id]) => ({ team, rank: rankOf(board, id) }))
        .filter(
          (h): h is { team: string; rank: number } =>
            h.rank !== null && isHidden(b, h.rank),
        );
      if (hits.length === 0) {
        resolveBank([b.control!]);
        return done(b);
      }
      const best = Math.min(...hits.map((h) => h.rank));
      for (const rank of new Set(hits.map((h) => h.rank))) {
        const finders = hits.filter((h) => h.rank === rank).map((h) => h.team);
        const p = points(rank);
        reveal(rank, finders, p);
        for (const t of finders) award(b, t, p);
      }
      resolveBank(hits.filter((h) => h.rank === best).map((h) => h.team));
      return done(b);
    }
    case "allPlayRound": {
      const wrong =
        needPhase("allPlay") ??
        checkTeams(Object.keys(action.answers), b.teams) ??
        checkAnswers(Object.values(action.answers));
      if (wrong) return wrong;
      const finders = new Map<number, string[]>();
      for (const team of b.teams) {
        const rank = rankOf(board, action.answers[team] ?? null);
        if (rank === null || !isHidden(b, rank)) continue;
        finders.set(rank, [...(finders.get(rank) ?? []), team]);
      }
      for (const [rank, teams] of [...finders].sort((x, y) => x[0] - y[0])) {
        const p = points(rank);
        reveal(rank, teams, p);
        for (const t of teams) award(b, t, p);
      }
      b.round++;
      if (allFound() || b.round >= rules.allPlayRounds) b.phase = "closed";
      return done(b);
    }
    case "closeBoard": {
      if (b.phase === "closed")
        return err({ kind: "wrongPhase", phase: b.phase });
      // Face-off styles: a bank already built goes to the playing team (or
      // the face-off winner if play hadn't started).
      const holder = b.control ?? b.faceOffWinner;
      if (b.bank > 0 && holder && b.bankWinners.length === 0) {
        resolveBank([holder]);
      }
      b.phase = "closed";
      return done(b);
    }
    case "revealRemaining": {
      const wrong = needPhase("closed");
      if (wrong) return wrong;
      board.answers.forEach((_a, i) => {
        if (isHidden(b, i + 1)) {
          b.revealed.push({
            rank: i + 1,
            teams: [],
            points: 0,
            leftover: true,
          });
        }
      });
      return done(b);
    }
  }
}

/**
 * Undo: go back to `previous`, but rows already shown to everyone stay
 * shown, for 0 points. They're marked as leftovers, so nobody can score
 * them later. An answer is never hidden again once people have seen it.
 */
export function undoTo(
  current: EngineState,
  previous: EngineState,
): EngineState {
  const restored: EngineState = structuredClone(previous);
  const now = current.board;
  const then = restored.board;
  if (now && now.boardId === then?.boardId) {
    for (const row of now.revealed) {
      if (!then.revealed.some((r) => r.rank === row.rank)) {
        then.revealed.push({ ...row, teams: [], points: 0, leftover: true });
      }
    }
  }
  return restored;
}
