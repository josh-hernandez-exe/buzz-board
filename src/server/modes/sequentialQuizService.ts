/**
 * Sequential Quiz on the Game Kit runner, plus teams' typed answers.
 *
 * Answers are stored per team (TeamAnswer), each with its own revision, so
 * teams never wait for or overwrite each other. A save is accepted only
 * while the question is open (checked under the game lock, so it can't
 * slip in after the host locks). A team sees only its own answer; owners
 * and co-hosts see them all; moderators and other teams never do.
 */
import { err, ok, type Result } from "neverthrow";

import { db } from "@/server/db";
import { answerProgress } from "@/server/db/common";
import {
  withGameLock,
  type GameTransactionError,
} from "@/server/db/gameTransaction";
import {
  actInModeSession,
  discardModeDraft,
  handOffToBasic,
  modeHostData,
  saveModeDraft,
  startModeSession,
  undoInModeSession,
  type ModeModule,
} from "@/server/modes/gameKit";
import { bankSchema, type Bank } from "@/utils/categoryGrid/content";
import {
  emptyQuizBank,
  normalizeAnswer,
  QUIZ_LIMITS,
  quizPreflight,
} from "@/utils/sequentialQuiz/content";
import {
  applyQuiz,
  initialQuizState,
  questionKey,
  undoQuiz,
  type QuizAction,
  type QuizError,
  type QuizState,
  type Verdict,
} from "@/utils/sequentialQuiz/engine";
import {
  projectQuiz,
  type PublicQuizView,
} from "@/utils/sequentialQuiz/projection";

export const QUIZ_KIND = "sequentialQuiz";

export const sequentialQuizModule: ModeModule<
  Bank,
  QuizState,
  QuizAction,
  QuizError
> = {
  kind: QUIZ_KIND,
  parseDraft: (raw) => {
    const parsed = bankSchema.safeParse(raw);
    return parsed.success
      ? ok(parsed.data)
      : err(
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        );
  },
  emptyDraft: () => emptyQuizBank(),
  preflight: (bank, teams) => quizPreflight(bank, teams.length),
  initialState: initialQuizState,
  // Grading and the reveal use the teams in the game now.
  withTeams: (state, _action, teams) => ({ ...state, teams }),
  apply: applyQuiz,
  undo: undoQuiz,
  ruleError: (error) => ({ kind: "quizRule", error }),
  enrich: async (tx, gameId, bank, state, action) => {
    if (action.type !== "resolveRemaining") return action;
    const key = questionKey(bank, state);
    const rows = key
      ? await tx.teamAnswer.findMany({
          where: { gameId, questionKey: key },
          select: { gameTeamId: true },
        })
      : [];
    return { ...action, answered: rows.map((r) => r.gameTeamId) };
  },
  // Two co-hosts can mark different answers at once; each grade checks
  // the verdict its screen showed.
  ignoresStep: (action) => action.type === "grade",
};

export type QuizHostView = Awaited<ReturnType<typeof quizHostView>>;

/** Everything the host desk needs, including answers. Owners and co-hosts only. */
export async function quizHostView(gameId: string) {
  const data = await modeHostData(sequentialQuizModule, gameId);
  const key =
    data.content && data.state ? questionKey(data.content, data.state) : null;
  const view: PublicQuizView | null =
    data.content &&
    data.state &&
    (data.status === "running" || data.status === "ended")
      ? projectQuiz(
          data.content,
          data.state,
          data.status,
          await answerProgress(gameId, key),
          data.step,
        )
      : null;
  return { ...data, view };
}

export const saveQuizDraft = (input: {
  gameId: string;
  draft: unknown;
  expectedRevision: number;
}) => saveModeDraft(sequentialQuizModule, input);
export const startQuiz = (gameId: string) =>
  startModeSession(sequentialQuizModule, gameId);
export const actInQuiz = (input: {
  gameId: string;
  actorUserId: string;
  action: QuizAction;
  expectedStep: number;
  requestId: string;
}) => actInModeSession(sequentialQuizModule, input);
export const undoInQuiz = (input: {
  gameId: string;
  actorUserId: string;
  expectedStep: number;
  requestId: string;
}) => undoInModeSession(sequentialQuizModule, input);
export const endQuiz = (gameId: string, actorUserId: string | null = null) =>
  handOffToBasic(gameId, actorUserId, QUIZ_KIND);
export const discardQuizDraft = (gameId: string) =>
  discardModeDraft(QUIZ_KIND, gameId);

// ------------------------------------------------------------ team answers

export type AnswerError =
  | GameTransactionError
  | { kind: "answersClosed" }
  | { kind: "emptyAnswer" }
  | { kind: "notOnTeam" }
  | { kind: "answerConflict"; revision: number; text: string; savedBy: string };

async function running(gameId: string) {
  const mode = await db.gameMode.findUnique({ where: { gameId } });
  if (mode?.kind !== QUIZ_KIND || mode.status !== "running") return null;
  const bank = bankSchema.safeParse(mode.content);
  if (!bank.success || !mode.state) return null;
  return { bank: bank.data, state: mode.state as QuizState };
}

/**
 * Saves or replaces the team's answer. `baseRevision` is the revision this
 * player last saw (0 for none): if a teammate saved since, nothing is
 * overwritten and the current answer comes back.
 */
export async function submitTeamAnswer({
  gameId,
  gameUserId,
  text,
  baseRevision,
}: {
  gameId: string;
  gameUserId: string;
  text: string;
  baseRevision: number;
}): Promise<Result<{ revision: number; savedAt: Date }, AnswerError>> {
  const clean = text.trim().slice(0, QUIZ_LIMITS.maxAnswerLength);
  // A blank answer isn't an answer: it stays a draft on the device.
  if (!clean) return err({ kind: "emptyAnswer" });
  type Saved = { revision: number; savedAt: Date };
  const outcome = await withGameLock(
    gameId,
    async (tx): Promise<Result<Saved, AnswerError>> => {
      const mode = await tx.gameMode.findUnique({ where: { gameId } });
      const bank =
        mode?.kind === QUIZ_KIND && mode.status === "running"
          ? bankSchema.safeParse(mode.content)
          : null;
      const state = mode?.state as QuizState | null;
      if (!bank?.success || state?.phase !== "open") {
        return err({ kind: "answersClosed" });
      }
      const key = questionKey(bank.data, state)!;
      const player = await tx.gameUser.findFirst({
        where: { id: gameUserId, gameId, removedAt: null },
        select: { gameTeamId: true },
      });
      if (!player?.gameTeamId) return err({ kind: "notOnTeam" });
      const where = {
        gameId_questionKey_gameTeamId: {
          gameId,
          questionKey: key,
          gameTeamId: player.gameTeamId,
        },
      };
      const existing = await tx.teamAnswer.findUnique({ where });
      if ((existing?.revision ?? 0) !== baseRevision) {
        const by = existing
          ? await tx.gameUser.findUnique({
              where: { id: existing.savedById },
              select: { name: true },
            })
          : null;
        return err({
          kind: "answerConflict",
          revision: existing?.revision ?? 0,
          text: existing?.text ?? "",
          savedBy: by?.name ?? "A teammate",
        });
      }
      const saved = existing
        ? await tx.teamAnswer.update({
            where,
            data: {
              text: clean,
              revision: { increment: 1 },
              savedById: gameUserId,
            },
          })
        : await tx.teamAnswer.create({
            data: {
              gameId,
              questionKey: key,
              gameTeamId: player.gameTeamId,
              text: clean,
              savedById: gameUserId,
            },
          });
      return ok({ revision: saved.revision, savedAt: saved.updatedAt });
    },
  );
  return outcome.isErr() ? err(outcome.error) : outcome.value;
}

export type MyTeamAnswer = {
  questionKey: string | null;
  open: boolean;
  /** False for a player not on a team: they can't answer. */
  onTeam: boolean;
  answer: {
    text: string;
    revision: number;
    savedBy: string;
    savedAt: Date;
  } | null;
  /** After the reveal: how the host marked the team. */
  verdict: Verdict | null;
};

/** The player's own team's answer to the current question. */
export async function myTeamAnswer(
  gameId: string,
  gameUserId: string,
): Promise<MyTeamAnswer> {
  const quiz = await running(gameId);
  const player = await db.gameUser.findFirst({
    where: { id: gameUserId, gameId, removedAt: null },
    select: { gameTeamId: true },
  });
  const key = quiz ? questionKey(quiz.bank, quiz.state) : null;
  if (!quiz || !key || !player?.gameTeamId) {
    return {
      questionKey: key,
      open: false,
      onTeam: !!player?.gameTeamId,
      answer: null,
      verdict: null,
    };
  }
  const row = await db.teamAnswer.findUnique({
    where: {
      gameId_questionKey_gameTeamId: {
        gameId,
        questionKey: key,
        gameTeamId: player.gameTeamId,
      },
    },
  });
  const by = row
    ? await db.gameUser.findUnique({
        where: { id: row.savedById },
        select: { name: true },
      })
    : null;
  return {
    questionKey: key,
    open: quiz.state.phase === "open",
    onTeam: true,
    answer: row
      ? {
          text: row.text,
          revision: row.revision,
          savedBy: by?.name ?? "A teammate",
          savedAt: row.updatedAt,
        }
      : null,
    verdict:
      quiz.state.phase === "revealed" && !quiz.state.voided
        ? (quiz.state.grades[player.gameTeamId] ?? null)
        : null,
  };
}

export type QuizResponse = {
  team: string;
  teamName: string;
  text: string | null;
  normalized: string | null;
  savedBy: string | null;
  verdict: Verdict | null;
};

/** Every team's answer to the current question, for marking. Hosts only. */
export async function quizResponses(gameId: string) {
  const quiz = await running(gameId);
  if (!quiz) return { questionKey: null, responses: [] as QuizResponse[] };
  const key = questionKey(quiz.bank, quiz.state);
  const [teams, rows] = await Promise.all([
    db.gameTeam.findMany({
      where: { gameId },
      orderBy: { index: "asc" },
      select: { id: true, name: true },
    }),
    key
      ? db.teamAnswer.findMany({ where: { gameId, questionKey: key } })
      : Promise.resolve([]),
  ]);
  const names = new Map(
    (
      await db.gameUser.findMany({
        where: { id: { in: rows.map((r) => r.savedById) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const responses: QuizResponse[] = teams.map((t) => {
    const row = rows.find((r) => r.gameTeamId === t.id);
    return {
      team: t.id,
      teamName: t.name,
      text: row?.text ?? null,
      normalized: row ? normalizeAnswer(row.text) : null,
      savedBy: row ? (names.get(row.savedById) ?? "A teammate") : null,
      verdict: quiz.state.grades[t.id] ?? null,
    };
  });
  return { questionKey: key, responses };
}
