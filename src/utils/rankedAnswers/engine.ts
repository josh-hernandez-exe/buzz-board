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

import {
  isFaceOffStyle,
  pointsFor,
  resolveRules,
  type Board,
  type Content,
  type Rules,
} from "./content";

export type Phase =
  | "faceOff"
  | "playOrPass"
  | "control"
  | "steal"
  | "turns"
  | "race"
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
  /** Points each team earned on this board (after any miss penalties). */
  awarded: Record<string, number>;
  bankWinners: string[];
  /** Buzz race: teams that can't answer right now. */
  lockedOut?: string[];
  /** Buzz race: misses per team on this board. */
  teamStrikes?: Record<string, number>;
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
  /** Buzz race: the team that buzzed, and its answer (null = wrong). */
  | { type: "raceAnswer"; team: string; answerId: string | null }
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
  | { kind: "teamLockedOut"; team: string }
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

/**
 * Who may steal once the playing team has struck out: the face-off
 * opponent, every other team, or nobody, by the rules.
 */
export function stealersOf(rules: Rules, b: BoardState): string[] {
  const { stealBy } = resolveRules(rules);
  if (stealBy === "none" || !b.control) return [];
  const others = b.teams.filter((t) => t !== b.control);
  if (stealBy === "everyone") return others;
  const opponent = b.faceOffTeams.filter((t) => t !== b.control);
  return opponent.length > 0 ? opponent : others.slice(0, 1);
}

/** The team answering now, in turn-based phases. */
export function currentTurnTeam(b: BoardState): string | null {
  return b.phase === "turns"
    ? (b.order[b.turn % b.order.length] ?? null)
    : null;
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
  const opts = resolveRules(rules);
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
    const style = rules.playStyle;
    const faceOffStyle = isFaceOffStyle(style);
    const noFaceOff = faceOffStyle && opts.faceOffMethod === "none";
    // Without a face-off, every team takes a turn playing, board by board;
    // the next team in the rotation is its opponent.
    const pair = !faceOffStyle
      ? []
      : noFaceOff
        ? rotate(teams, n).slice(0, 2)
        : faceOffPair(teams, n);
    const turnStyle = style === "roundRobin" || style === "passAlong";
    const next: BoardState = {
      boardId: board.id,
      teams,
      phase: noFaceOff
        ? "control"
        : faceOffStyle
          ? "faceOff"
          : turnStyle
            ? "turns"
            : style === "buzzRace"
              ? "race"
              : "allPlay",
      revealed: [],
      strikes: 0,
      bank: 0,
      faceOffTeams: pair,
      faceOffWinner: noFaceOff ? pair[0]! : null,
      control: noFaceOff ? pair[0]! : null,
      order: turnStyle ? rotate(teams, n) : [...teams],
      turn: 0,
      round: 0,
      awarded: {},
      bankWinners: [],
      lockedOut: [],
      teamStrikes: {},
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
    b.bankWinners = b.bank > 0 ? winners : [];
    for (const t of winners) award(b, t, b.bank);
    b.phase = "closed";
  };
  const direct = opts.scoring === "direct";
  /** A row found while a team holds the board: banked, or scored at once. */
  const bankOrAward = (rank: number, team: string | null) => {
    const p = points(rank);
    if (direct && team) {
      reveal(rank, [team], p);
      award(b, team, p);
    } else {
      reveal(rank, [], p);
      b.bank += p;
    }
  };
  const penalize = (team: string) => {
    if (scoring && opts.missPenalty > 0) award(b, team, -opts.missPenalty);
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
      action.answers.forEach((a, i) => {
        const r = ranks[i] ?? null;
        if (r !== null && isHidden(b, r)) bankOrAward(r, a.team);
      });
      if (winner) {
        b.faceOffWinner = winner;
        if (opts.allowPass) {
          b.phase = "playOrPass";
        } else {
          b.control = winner;
          b.phase = "control";
        }
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
          bankOrAward(rank, b.control);
          if (allFound()) resolveBank([b.control!]);
        } else {
          b.strikes++;
          penalize(b.control!);
          if (b.strikes >= rules.strikes) {
            if (stealersOf(rules, b).length > 0) b.phase = "steal";
            else resolveBank([b.control!]);
          }
        }
        return done(b);
      }
      // Round robin: the current team's one answer. Pass-along: the team
      // keeps going until it misses.
      const team = b.order[b.turn % b.order.length]!;
      if (found) {
        const p = points(rank);
        reveal(rank, [team], p);
        award(b, team, p);
      } else {
        penalize(team);
      }
      if (rules.playStyle !== "passAlong" || !found) b.turn++;
      if (allFound() || b.turn >= b.order.length * rules.turnCycles) {
        b.phase = "closed";
      }
      return done(b);
    }
    case "steal": {
      const stealers = stealersOf(rules, b);
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
      if (direct || opts.stealReward === "rowOnly") {
        // The stealers had their rows; the playing team keeps any bank.
        resolveBank([b.control!]);
      } else if (opts.stealWinner === "allCorrect") {
        resolveBank([...new Set(hits.map((h) => h.team))]);
      } else {
        resolveBank(hits.filter((h) => h.rank === best).map((h) => h.team));
      }
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
        const each =
          teams.length === 1 || opts.sharedAnswers === "full"
            ? p
            : opts.sharedAnswers === "split"
              ? Math.floor(p / teams.length)
              : 0;
        reveal(rank, teams, each);
        for (const t of teams) award(b, t, each);
      }
      b.round++;
      if (allFound() || b.round >= rules.allPlayRounds) b.phase = "closed";
      return done(b);
    }
    case "raceAnswer": {
      const wrong =
        needPhase("race") ??
        checkTeams([action.team], b.teams) ??
        checkAnswers([action.answerId]);
      if (wrong) return wrong;
      const locked = b.lockedOut ?? [];
      if (locked.includes(action.team)) {
        return err({ kind: "teamLockedOut", team: action.team });
      }
      const rank = rankOf(board, action.answerId);
      if (rank !== null && isHidden(b, rank)) {
        const p = points(rank);
        reveal(rank, [action.team], p);
        award(b, action.team, p);
        // A find gives everyone waiting out another go.
        if (opts.raceLockout === "untilNextFind") b.lockedOut = [];
        if (allFound()) b.phase = "closed";
        return done(b);
      }
      penalize(action.team);
      const misses = (b.teamStrikes?.[action.team] ?? 0) + 1;
      b.teamStrikes = { ...b.teamStrikes, [action.team]: misses };
      if (
        opts.raceLockout === "untilNextFind" ||
        (opts.raceLockout === "afterStrikes" && misses >= rules.strikes)
      ) {
        b.lockedOut = [...locked, action.team];
      }
      if (b.teams.every((t) => b.lockedOut?.includes(t))) {
        if (opts.raceLockout === "afterStrikes") {
          // Everyone has struck out of this board.
          b.phase = "closed";
        } else {
          // Nobody could find another: everyone gets another go.
          b.lockedOut = [];
        }
      }
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
