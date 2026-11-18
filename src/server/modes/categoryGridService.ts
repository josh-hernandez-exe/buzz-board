/**
 * Category Grid on the Game Kit runner: this file only describes the mode;
 * ./gameKit.ts does locking, receipts, scores, undo and handoff.
 */
import { err, ok } from "neverthrow";

import {
  actInModeSession,
  discardModeDraft,
  handOffToBasic,
  modeHostData,
  saveModeDraft,
  startModeSession,
  undoInModeSession,
  type GameKitError,
  type ModeModule,
} from "@/server/modes/gameKit";
import {
  bankSchema,
  emptyBank,
  gridPreflight,
  type Bank,
} from "@/utils/categoryGrid/content";
import {
  applyGrid,
  initialGridState,
  undoGrid,
  type GridAction,
  type GridError,
  type GridState,
} from "@/utils/categoryGrid/engine";
import {
  projectGrid,
  type PublicGridView,
} from "@/utils/categoryGrid/projection";

export const GRID_KIND = "categoryGrid";
export type GridModeError = GameKitError;

export const categoryGridModule: ModeModule<
  Bank,
  GridState,
  GridAction,
  GridError
> = {
  kind: GRID_KIND,
  parseDraft: (raw) => {
    const parsed = bankSchema.safeParse(raw);
    return parsed.success
      ? ok(parsed.data)
      : err(
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        );
  },
  emptyDraft: () => emptyBank(),
  preflight: (bank, teams) => gridPreflight(bank, teams.length),
  initialState: initialGridState,
  // Judging and picking use the teams in the game now.
  withTeams: (state, _action, teams) => ({ ...state, teams }),
  apply: applyGrid,
  undo: undoGrid,
  ruleError: (error) => ({ kind: "gridRule", error }),
};

export type GridHostView = Awaited<ReturnType<typeof gridHostView>>;

/** Everything the host desk needs, including answers. Owners and co-hosts only. */
export async function gridHostView(gameId: string) {
  const data = await modeHostData(categoryGridModule, gameId);
  const view: PublicGridView | null =
    data.content &&
    data.state &&
    (data.status === "running" || data.status === "ended")
      ? projectGrid(data.content, data.state, data.status)
      : null;
  return { ...data, view };
}

export const saveGridDraft = (input: {
  gameId: string;
  draft: unknown;
  expectedRevision: number;
}) => saveModeDraft(categoryGridModule, input);

export const startGrid = (gameId: string) =>
  startModeSession(categoryGridModule, gameId);

export const actInGrid = (input: {
  gameId: string;
  actorUserId: string;
  action: GridAction;
  expectedStep: number;
  requestId: string;
}) => actInModeSession(categoryGridModule, input);

export const undoInGrid = (input: {
  gameId: string;
  actorUserId: string;
  expectedStep: number;
  requestId: string;
}) => undoInModeSession(categoryGridModule, input);

/** "Use basic controls": see handOffToBasic. */
export const endGrid = (gameId: string, actorUserId: string | null = null) =>
  handOffToBasic(gameId, actorUserId, GRID_KIND);

export const discardGridDraft = (gameId: string) =>
  discardModeDraft(GRID_KIND, gameId);
