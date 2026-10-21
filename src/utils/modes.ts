/**
 * The game modes a game can run (one at a time), and the public view of
 * whichever is running. Each mode keeps its own content, engine and
 * projection; this only dispatches on the stored kind.
 */
import { bankSchema } from "@/utils/categoryGrid/content";
import type { GridState } from "@/utils/categoryGrid/engine";
import {
  projectGrid,
  type PublicGridView,
} from "@/utils/categoryGrid/projection";
import {
  publicModeView,
  type PublicModeView,
} from "@/utils/rankedAnswers/projection";

export const MODE_KINDS = ["rankedAnswers", "categoryGrid"] as const;
export type ModeKind = (typeof MODE_KINDS)[number];

export const MODE_LABEL: Record<ModeKind, string> = {
  rankedAnswers: "Ranked Answers",
  categoryGrid: "Category Grid",
};

export type PublicGameModeView = PublicModeView | PublicGridView;

/** The public view from a stored mode record, or null before it starts. */
export function publicGameModeView(
  mode:
    | { kind: string; status: string; content: unknown; state: unknown }
    | null
    | undefined,
): PublicGameModeView | null {
  if (!mode || mode.status === "draft" || !mode.content || !mode.state) {
    return null;
  }
  if (mode.kind === "categoryGrid") {
    return projectGrid(
      bankSchema.parse(mode.content),
      mode.state as GridState,
      mode.status === "ended" ? "ended" : "running",
    );
  }
  return publicModeView(mode);
}
