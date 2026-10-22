/**
 * What players and the audience see of a Category Grid: tiles show only
 * their label and points; a clue's text appears only while it's open; an
 * answer only once it's shown. Accepted answers and host notes never leave
 * the server except to hosts.
 */
import { safeMediaList, type Media } from "@/utils/media";

import { findCell, gridOf, type Bank } from "./content";
import { gridPhase, type GridPhase, type GridState } from "./engine";

export type PublicTile = {
  key: string;
  label: string;
  points: number;
  state: "available" | "active" | "correct" | "unanswered" | "void";
  /** Who got it right. */
  team: string | null;
};

export type PublicClue = {
  key: string;
  category: string;
  label: string;
  points: number;
  prompt: string;
  /** Safe media only; loaded by the viewer's browser once the clue opens. */
  promptMedia: Media[];
  /** null until the answer is shown. */
  answer: string | null;
  answerMedia: Media[];
  phase: "open" | "answered";
  lockedOut: string[];
  attempts: { team: string; correct: boolean }[];
  winner: string | null;
};

export type PublicGridView = {
  kind: "categoryGrid";
  status: "running" | "ended";
  title: string;
  phase: GridPhase;
  columns: { title: string; tiles: PublicTile[] }[];
  clue: PublicClue | null;
  selector: string | null;
  finished: boolean;
};

export function projectGrid(
  bank: Bank,
  state: GridState,
  status: "running" | "ended",
): PublicGridView {
  const columns = gridOf(bank).columns.map((column) => ({
    title: column.title,
    tiles: column.cells.map((cell, row): PublicTile => {
      const key = `${column.id}:${row}`;
      const used = state.used[key];
      return {
        key,
        label: cell.label,
        points: cell.points,
        state:
          state.clue?.cell === key ? "active" : (used?.result ?? "available"),
        team: used?.team ?? null,
      };
    }),
  }));
  let clue: PublicClue | null = null;
  if (state.clue) {
    const found = findCell(bank, state.clue.cell);
    if (found?.question) {
      clue = {
        key: state.clue.cell,
        category: found.column.title,
        label: found.cell.label,
        points: found.cell.points,
        prompt: found.question.prompt.text,
        promptMedia: safeMediaList(found.question.prompt.media),
        answer: state.clue.answerShown ? found.question.answer.text : null,
        answerMedia: state.clue.answerShown
          ? safeMediaList(found.question.answer.media)
          : [],
        phase: state.clue.phase,
        lockedOut: state.clue.lockedOut,
        attempts: state.clue.attempts.map(({ team, correct }) => ({
          team,
          correct,
        })),
        winner: state.clue.winner,
      };
    }
  }
  return {
    kind: "categoryGrid",
    status,
    title: bank.title,
    phase: gridPhase(state),
    columns,
    clue,
    selector: state.selector,
    finished: state.finished,
  };
}
