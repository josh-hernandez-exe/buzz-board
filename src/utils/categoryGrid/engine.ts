/**
 * The Category Grid engine: (state, host action) -> (new state, points).
 * Pure and deterministic, like the Ranked Answers engine, so the server
 * runs it in the same transaction that writes scores.
 *
 * Flow: the selecting team picks a tile, the host opens its clue and the
 * buzzer, then judges answers. A right answer scores the clue's value and
 * gives that team the next pick; a wrong one can lock the team out of the
 * clue and cost its value. The host can reveal the answer when nobody gets
 * it, or void a flawed clue (taking back only that clue's points).
 */
import { err, ok, type Result } from "neverthrow";

import { findCell, resolveGridRules, type Bank } from "./content";

export type ClueAttempt = {
  team: string;
  correct: boolean;
  /** Points this attempt changed (negative for a penalty). */
  points: number;
};

export type ClueState = {
  cell: string;
  /** "open": the clue is shown and teams answer. "answered": the answer is shown. */
  phase: "open" | "answered";
  lockedOut: string[];
  attempts: ClueAttempt[];
  winner: string | null;
  /** Stays true once the answer was on screens, even across undo. */
  answerShown: boolean;
  /** Who was picking before this clue, for a void. */
  selectorBefore: string | null;
};

export type CellResult = {
  result: "correct" | "unanswered" | "void";
  team: string | null;
};

export type GridState = {
  teams: string[];
  /** Tiles that are done. */
  used: Record<string, CellResult>;
  clue: ClueState | null;
  /** The team that picks the next tile. */
  selector: string | null;
  finished: boolean;
  /** Tiles whose clue was shown: they can never be opened again. */
  spent: string[];
};

export type GridAction =
  | { type: "openClue"; cell: string }
  | { type: "judge"; team: string; correct: boolean }
  /** Nobody got it: show the answer, no points. */
  | { type: "revealAnswer" }
  /** Back to the board once the answer is shown. */
  | { type: "closeClue" }
  /** A flawed clue: take back its points; the tile is spent. */
  | { type: "voidClue" }
  | { type: "setSelector"; team: string | null }
  | { type: "finish" };

export type GridPhase = "board" | "open" | "answered" | "finished";

export type GridError =
  | { kind: "gridWrongPhase"; phase: GridPhase }
  | { kind: "unknownCell" }
  | { kind: "cellUsed" }
  | { kind: "unknownTeam"; team: string }
  | { kind: "teamLockedOut"; team: string };

export type GridStep = { state: GridState; scores: Record<string, number> };

export function initialGridState(teams: string[]): GridState {
  return {
    teams,
    used: {},
    clue: null,
    selector: teams[0] ?? null,
    finished: false,
    spent: [],
  };
}

export const gridPhase = (s: GridState): GridPhase =>
  s.finished ? "finished" : (s.clue?.phase ?? "board");

export function applyGrid(
  bank: Bank,
  state: GridState,
  action: GridAction,
): Result<GridStep, GridError> {
  const rules = resolveGridRules(bank.modes.categoryGrid.rules);
  const phase = gridPhase(state);
  const scores: Record<string, number> = {};
  const award = (team: string, points: number) => {
    if (points !== 0) scores[team] = (scores[team] ?? 0) + points;
  };
  const wrongPhase = () => err({ kind: "gridWrongPhase" as const, phase });
  const done = (next: GridState) => ok({ state: next, scores });
  const checkTeam = (team: string) =>
    state.teams.includes(team)
      ? null
      : err({ kind: "unknownTeam" as const, team });

  switch (action.type) {
    case "openClue": {
      if (phase !== "board") return wrongPhase();
      const found = findCell(bank, action.cell);
      if (!found?.question) return err({ kind: "unknownCell" });
      if (state.used[action.cell] || state.spent.includes(action.cell)) {
        return err({ kind: "cellUsed" });
      }
      return done({
        ...state,
        clue: {
          cell: action.cell,
          phase: "open",
          lockedOut: [],
          attempts: [],
          winner: null,
          answerShown: false,
          selectorBefore: state.selector,
        },
        spent: [...state.spent, action.cell],
      });
    }
    case "judge": {
      if (phase !== "open") return wrongPhase();
      const bad = checkTeam(action.team);
      if (bad) return bad;
      const clue = state.clue!;
      if (clue.lockedOut.includes(action.team)) {
        return err({ kind: "teamLockedOut", team: action.team });
      }
      const { cell } = findCell(bank, clue.cell)!;
      if (action.correct) {
        award(action.team, cell.points);
        return done({
          ...state,
          selector: action.team,
          clue: {
            ...clue,
            phase: "answered",
            winner: action.team,
            answerShown: true,
            attempts: [
              ...clue.attempts,
              { team: action.team, correct: true, points: cell.points },
            ],
          },
        });
      }
      const penalty =
        rules.wrongAnswerPenalty === "clueValue" ? -cell.points : 0;
      award(action.team, penalty);
      return done({
        ...state,
        clue: {
          ...clue,
          lockedOut: rules.wrongAnswerLockout
            ? [...clue.lockedOut, action.team]
            : clue.lockedOut,
          attempts: [
            ...clue.attempts,
            { team: action.team, correct: false, points: penalty },
          ],
        },
      });
    }
    case "revealAnswer": {
      if (phase !== "open") return wrongPhase();
      return done({
        ...state,
        clue: { ...state.clue!, phase: "answered", answerShown: true },
      });
    }
    case "closeClue": {
      if (phase !== "answered") return wrongPhase();
      const clue = state.clue!;
      return done({
        ...state,
        clue: null,
        used: {
          ...state.used,
          [clue.cell]: {
            result: clue.winner ? "correct" : "unanswered",
            team: clue.winner,
          },
        },
      });
    }
    case "voidClue": {
      if (phase !== "open" && phase !== "answered") return wrongPhase();
      const clue = state.clue!;
      // Take back exactly what this clue changed, and give the pick back.
      for (const a of clue.attempts) award(a.team, -a.points);
      return done({
        ...state,
        clue: null,
        selector: clue.selectorBefore,
        used: { ...state.used, [clue.cell]: { result: "void", team: null } },
      });
    }
    case "setSelector": {
      if (phase === "finished") return wrongPhase();
      if (action.team !== null) {
        const bad = checkTeam(action.team);
        if (bad) return bad;
      }
      return done({ ...state, selector: action.team });
    }
    case "finish": {
      if (phase !== "board") return wrongPhase();
      return done({ ...state, finished: true });
    }
  }
}

/**
 * Undo: go back to `previous`, but nothing people have seen is hidden
 * again. A clue that was shown stays spent (its tile is void unless it's
 * the clue being restored), and a shown answer stays shown.
 */
export function undoGrid(current: GridState, previous: GridState): GridState {
  const restored: GridState = structuredClone(previous);
  const spent = new Set([...previous.spent, ...current.spent]);
  restored.spent = [...spent];
  // Undoing a judgement on the same clue: if the answer was on screen, it
  // stays on screen.
  if (restored.clue && current.clue?.cell === restored.clue.cell) {
    restored.clue.answerShown ||= current.clue.answerShown;
  }
  for (const cell of spent) {
    if (!restored.used[cell] && restored.clue?.cell !== cell) {
      restored.used[cell] = { result: "void", team: null };
    }
  }
  return restored;
}
