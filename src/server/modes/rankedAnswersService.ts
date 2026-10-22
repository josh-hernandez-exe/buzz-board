/**
 * Ranked Answers on the Game Kit runner: this file only describes the
 * mode (content, preflight, engine, undo); the shared runner in
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
  type Preflight,
} from "@/server/modes/gameKit";
import {
  contentSchema,
  defaultRules,
  preflight,
  type Content,
} from "@/utils/rankedAnswers/content";
import {
  apply,
  initialState,
  undoTo,
  type Action,
  type EngineError,
  type EngineState,
} from "@/utils/rankedAnswers/engine";
import {
  projectPublic,
  type PublicModeView,
} from "@/utils/rankedAnswers/projection";

export const MODE_KIND = "rankedAnswers";
export type ModeError = GameKitError;

export const rankedAnswersModule: ModeModule<
  Content,
  EngineState,
  Action,
  EngineError
> = {
  kind: MODE_KIND,
  parseDraft: (raw) => {
    const parsed = contentSchema.safeParse(raw);
    return parsed.success
      ? ok(parsed.data)
      : err(
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        );
  },
  emptyDraft: (teamCount) => ({ rules: defaultRules(teamCount), boards: [] }),
  preflight: (content, teams): Preflight => {
    const check = preflight(content, teams.length);
    const emptyTeams = teams
      .filter((t) => t.players === 0)
      .map((t) => `${t.name} has no players yet.`);
    return { ...check, warnings: [...check.warnings, ...emptyTeams] };
  },
  initialState,
  // Each board is played by the teams in the game when it starts: a team
  // added since joins in, a deleted one drops out.
  withTeams: (state, action, teams) =>
    action.type === "startBoard" ? { ...state, teams } : state,
  apply,
  undo: undoTo,
  ruleError: (error) => ({ kind: "modeRule", error }),
};

export type HostView = Awaited<ReturnType<typeof hostView>>;

/** Everything the host desk needs, including every answer. Staff only. */
export async function hostView(gameId: string) {
  const data = await modeHostData(rankedAnswersModule, gameId);
  const view: PublicModeView | null =
    data.content &&
    data.state &&
    (data.status === "running" || data.status === "ended")
      ? projectPublic(data.content, data.state, data.status)
      : null;
  return { ...data, view };
}

export const saveDraft = (input: {
  gameId: string;
  draft: unknown;
  expectedRevision: number;
}) => saveModeDraft(rankedAnswersModule, input);

export const startMode = (gameId: string) =>
  startModeSession(rankedAnswersModule, gameId);

export const actInMode = (input: {
  gameId: string;
  actorUserId: string;
  action: Action;
  expectedStep: number;
  requestId: string;
}) => actInModeSession(rankedAnswersModule, input);

export const undoInMode = (input: {
  gameId: string;
  actorUserId: string;
  expectedStep: number;
  requestId: string;
}) => undoInModeSession(rankedAnswersModule, input);

/** "Use basic controls": see handOffToBasic. */
export const endMode = (gameId: string, actorUserId: string | null = null) =>
  handOffToBasic(gameId, actorUserId, MODE_KIND);

export const discardDraft = (gameId: string) =>
  discardModeDraft(MODE_KIND, gameId);
