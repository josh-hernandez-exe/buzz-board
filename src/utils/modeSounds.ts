/**
 * Which sound a change on a game-mode board deserves. Pure, so it's tested
 * without audio: compare the previous public view with the new one.
 */
import type { PublicGameModeView } from "@/utils/modes";

export type ModeCue = "reveal" | "correct" | "strike";

export function modeSoundCues(
  prev: PublicGameModeView | null,
  next: PublicGameModeView | null,
): ModeCue[] {
  if (!next || prev?.kind !== next.kind) return [];
  if (next.kind === "rankedAnswers" && prev.kind === "rankedAnswers") {
    const a = prev.board;
    const b = next.board;
    if (!b || a?.id !== b.id) return [];
    const cues: ModeCue[] = [];
    const found = (rows: typeof b.rows) =>
      rows.filter((r) => r.text !== null && !r.leftover).length;
    if (found(b.rows) > found(a.rows)) cues.push("reveal");
    if (b.strikes > a.strikes) cues.push("strike");
    return cues;
  }
  if (next.kind === "categoryGrid" && prev.kind === "categoryGrid") {
    const a = prev.clue;
    const b = next.clue;
    if (!b || a?.key !== b.key) return [];
    const cues: ModeCue[] = [];
    const added = b.attempts.slice(a.attempts.length);
    if (added.some((x) => !x.correct)) cues.push("strike");
    if (added.some((x) => x.correct)) cues.push("correct");
    else if (a.answer === null && b.answer !== null) cues.push("reveal");
    return cues;
  }
  if (next.kind === "sequentialQuiz" && prev.kind === "sequentialQuiz") {
    // The reveal: a fanfare if anyone got it, otherwise the plain reveal.
    if (prev.phase !== "revealed" && next.phase === "revealed") {
      if (next.voided) return [];
      return next.correct.length > 0 ? ["correct"] : ["reveal"];
    }
    return [];
  }
  return [];
}
