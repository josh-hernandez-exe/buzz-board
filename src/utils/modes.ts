/**
 * The game modes a game can run (one at a time), and the public view of
 * whichever is running. Each mode keeps its own content, engine and
 * projection; this only dispatches on the stored kind.
 */
import { bankSchema } from "@/utils/categoryGrid/content";
import { contentSchema } from "@/utils/rankedAnswers/content";
import type { QuizState } from "@/utils/sequentialQuiz/engine";
import {
  projectQuiz,
  type AnswerProgress,
  type PublicQuizView,
} from "@/utils/sequentialQuiz/projection";
import type { GridState } from "@/utils/categoryGrid/engine";
import {
  projectGrid,
  type PublicGridView,
} from "@/utils/categoryGrid/projection";
import {
  publicModeView,
  type PublicModeView,
} from "@/utils/rankedAnswers/projection";

export const MODE_KINDS = [
  "rankedAnswers",
  "categoryGrid",
  "sequentialQuiz",
] as const;
export type ModeKind = (typeof MODE_KINDS)[number];

export const isModeKind = (kind: string): kind is ModeKind =>
  (MODE_KINDS as readonly string[]).includes(kind);

export const MODE_LABEL: Record<ModeKind, string> = {
  rankedAnswers: "Ranked Answers",
  categoryGrid: "Category Grid",
  sequentialQuiz: "Sequential Quiz",
};

export type PublicGameModeView =
  | PublicModeView
  | PublicGridView
  | PublicQuizView;

/**
 * The public view from a stored mode record, or null before it starts.
 * A mode this version doesn't know, or content it can't read (after a
 * rollback, say), shows nothing rather than breaking the game: scores,
 * teams, chat and the buzzer keep working.
 */
export function publicGameModeView(
  mode:
    | {
        kind: string;
        status: string;
        content: unknown;
        state: unknown;
        step?: number;
      }
    | null
    | undefined,
  /** Sequential Quiz: which teams answered the current question. */
  answered?: AnswerProgress,
): PublicGameModeView | null {
  if (!mode || mode.status === "draft" || !mode.content || !mode.state) {
    return null;
  }
  try {
    if (mode.kind === "categoryGrid") {
      const bank = bankSchema.safeParse(mode.content);
      if (!bank.success) return null;
      return projectGrid(
        bank.data,
        mode.state as GridState,
        mode.status === "ended" ? "ended" : "running",
      );
    }
    if (mode.kind === "sequentialQuiz") {
      const bank = bankSchema.safeParse(mode.content);
      if (!bank.success) return null;
      return projectQuiz(
        bank.data,
        mode.state as QuizState,
        mode.status === "ended" ? "ended" : "running",
        answered,
        mode.step,
      );
    }
    if (mode.kind === "rankedAnswers") {
      const content = contentSchema.safeParse(mode.content);
      if (!content.success) return null;
      return publicModeView({ ...mode, content: content.data });
    }
  } catch {
    // Unreadable state: fall through.
  }
  return null;
}
