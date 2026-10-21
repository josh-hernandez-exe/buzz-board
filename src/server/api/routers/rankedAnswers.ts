import { z } from "zod";

import { toTRPCError } from "@/server/api/errors";
import { createTRPCRouter, staffProcedure } from "@/server/api/trpc";
import {
  actInMode,
  discardDraft,
  endMode,
  hostView,
  saveDraft,
  startMode,
  undoInMode,
  type ModeError,
} from "@/server/modes/rankedAnswersService";
import { emitUpdatedGameState } from "@/server/utils/events";
import { type Result } from "neverthrow";

const id = z.string().min(1).max(64);
const answerId = id.nullable();
const requestId = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("startBoard"),
    boardId: id,
    teams: z.array(id).min(2).max(50).optional(),
  }),
  z.object({
    type: z.literal("faceOff"),
    answers: z
      .array(z.object({ team: id, answerId }))
      .min(1)
      .max(2),
  }),
  z.object({ type: z.literal("playOrPass"), play: z.boolean() }),
  z.object({ type: z.literal("answer"), answerId }),
  z.object({ type: z.literal("steal"), answers: z.record(id, answerId) }),
  z.object({
    type: z.literal("allPlayRound"),
    answers: z.record(id, answerId),
  }),
  z.object({ type: z.literal("raceAnswer"), team: id, answerId }),
  z.object({
    type: z.literal("credit"),
    answerId: id,
    teams: z.array(id).max(50),
  }),
  z.object({ type: z.literal("miss"), team: id }),
  z.object({ type: z.literal("closeBoard") }),
  z.object({ type: z.literal("voidBoard") }),
  z.object({ type: z.literal("revealRemaining") }),
  z.object({ type: z.literal("finish") }),
]);

/** Running the mode needs the same role as running the buzzer and scores. */
const hostProcedure = staffProcedure("runGame");

async function control<T>(
  gameId: string,
  result: Promise<Result<T, ModeError>>,
) {
  const outcome = await result;
  if (outcome.isErr()) throw toTRPCError(outcome.error);
  await emitUpdatedGameState({ gameId });
  return outcome.value;
}

/** Ranked Answers: the host's editor and controls. Players only ever get the public projection in the game state. */
export const rankedAnswersRouter = createTRPCRouter({
  hostView: hostProcedure.query(({ ctx }) => hostView(ctx.gameSession.id)),
  saveDraft: hostProcedure
    .input(z.object({ draft: z.unknown(), expectedRevision: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const result = await saveDraft({
        gameId: ctx.gameSession.id,
        draft: input.draft,
        expectedRevision: input.expectedRevision,
      });
      if (result.isErr()) throw toTRPCError(result.error);
      return result.value;
    }),
  discardDraft: hostProcedure.mutation(({ ctx }) =>
    control(ctx.gameSession.id, discardDraft(ctx.gameSession.id)),
  ),
  start: hostProcedure.mutation(({ ctx }) =>
    control(ctx.gameSession.id, startMode(ctx.gameSession.id)),
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
        actInMode({
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
        undoInMode({
          gameId: ctx.gameSession.id,
          actorUserId: ctx.session.user.id,
          ...input,
        }),
      ),
    ),
  end: hostProcedure.mutation(({ ctx }) =>
    control(ctx.gameSession.id, endMode(ctx.gameSession.id)),
  ),
});
