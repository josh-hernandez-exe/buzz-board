import { TRPCError } from "@trpc/server";
import type { Result } from "neverthrow";
import { z } from "zod";

import { toTRPCError } from "@/server/api/errors";
import {
  createTRPCRouter,
  protectedGameUserProcedure,
  staffProcedure,
} from "@/server/api/trpc";
import type { GameKitError } from "@/server/modes/gameKit";
import {
  actInQuiz,
  discardQuizDraft,
  endQuiz,
  myTeamAnswer,
  quizHostView,
  quizResponses,
  saveQuizDraft,
  startQuiz,
  submitTeamAnswer,
  undoInQuiz,
} from "@/server/modes/sequentialQuizService";
import { emitUpdatedGameState } from "@/server/utils/events";
import { takeRateLimit } from "@/server/utils/rateLimit";
import { QUIZ_LIMITS } from "@/utils/sequentialQuiz/content";

const id = z.string().min(1).max(64);
const requestId = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const key = z.string().min(1).max(140);
const verdict = z.enum(["correct", "incorrect", "missing"]).nullable();

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("lock") }),
  z.object({ type: z.literal("reopen") }),
  z.object({
    type: z.literal("grade"),
    key,
    teams: z.array(id).min(1).max(64),
    verdict: z.enum(["correct", "incorrect"]),
    from: z.record(id, verdict),
  }),
  // `answered` is filled in by the server, never taken from the client.
  z.object({ type: z.literal("resolveRemaining") }),
  z.object({ type: z.literal("reveal") }),
  z.object({ type: z.literal("void") }),
  z.object({ type: z.literal("finish") }),
]);

/** Running the quiz needs the same role as running the buzzer and scores. */
const hostProcedure = staffProcedure("runGame");

async function control<T>(
  gameId: string,
  result: Promise<Result<T, GameKitError>>,
) {
  const outcome = await result;
  if (outcome.isErr()) throw toTRPCError(outcome.error);
  await emitUpdatedGameState({ gameId });
  return outcome.value;
}

/**
 * Sequential Quiz: the host's editor and controls, plus each team's answer.
 * Answer text only ever goes to the team that wrote it and to hosts; the
 * shared game state carries just which teams have answered.
 */
export const sequentialQuizRouter = createTRPCRouter({
  hostView: hostProcedure.query(({ ctx }) => quizHostView(ctx.gameSession.id)),
  responses: hostProcedure.query(({ ctx }) =>
    quizResponses(ctx.gameSession.id),
  ),
  saveDraft: hostProcedure
    .input(z.object({ draft: z.unknown(), expectedRevision: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const result = await saveQuizDraft({
        gameId: ctx.gameSession.id,
        draft: input.draft,
        expectedRevision: input.expectedRevision,
      });
      if (result.isErr()) throw toTRPCError(result.error);
      return result.value;
    }),
  discardDraft: hostProcedure.mutation(({ ctx }) =>
    control(ctx.gameSession.id, discardQuizDraft(ctx.gameSession.id)),
  ),
  start: hostProcedure.mutation(({ ctx }) =>
    control(ctx.gameSession.id, startQuiz(ctx.gameSession.id)),
  ),
  act: hostProcedure
    .input(
      z.object({
        action: actionSchema,
        expectedStep: z.number().int(),
        requestId,
      }),
    )
    .mutation(({ ctx, input }) =>
      control(
        ctx.gameSession.id,
        actInQuiz({
          gameId: ctx.gameSession.id,
          actorUserId: ctx.session.user.id,
          ...input,
        }),
      ),
    ),
  undo: hostProcedure
    .input(z.object({ expectedStep: z.number().int(), requestId }))
    .mutation(({ ctx, input }) =>
      control(
        ctx.gameSession.id,
        undoInQuiz({
          gameId: ctx.gameSession.id,
          actorUserId: ctx.session.user.id,
          ...input,
        }),
      ),
    ),
  end: hostProcedure.mutation(({ ctx }) =>
    control(
      ctx.gameSession.id,
      endQuiz(ctx.gameSession.id, ctx.session.user.id),
    ),
  ),

  myAnswer: protectedGameUserProcedure.query(({ ctx }) =>
    myTeamAnswer(ctx.gameSession.id, ctx.gameSession.gameUser.id),
  ),
  submitAnswer: protectedGameUserProcedure
    .input(
      z.object({
        /** The question the player's screen showed. */
        questionKey: key,
        text: z.string().max(QUIZ_LIMITS.maxAnswerLength * 2),
        baseRevision: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const gameUserId = ctx.gameSession.gameUser.id;
      const limit = await takeRateLimit("teamAnswer", gameUserId);
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many saves. Wait ${limit.retryAfterSeconds} seconds and try again.`,
        });
      }
      const result = await submitTeamAnswer({
        gameId: ctx.gameSession.id,
        gameUserId,
        ...input,
      });
      if (result.isErr()) throw toTRPCError(result.error);
      await emitUpdatedGameState({ gameId: ctx.gameSession.id });
      return result.value;
    }),
});
