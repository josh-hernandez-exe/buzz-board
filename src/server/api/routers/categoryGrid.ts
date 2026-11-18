import type { Result } from "neverthrow";
import { z } from "zod";

import { toTRPCError } from "@/server/api/errors";
import { createTRPCRouter, staffProcedure } from "@/server/api/trpc";
import {
  actInGrid,
  discardGridDraft,
  endGrid,
  gridHostView,
  saveGridDraft,
  startGrid,
  undoInGrid,
  type GridModeError,
} from "@/server/modes/categoryGridService";
import { emitUpdatedGameState } from "@/server/utils/events";

const id = z.string().min(1).max(64);
const cell = z.string().min(3).max(140);
const requestId = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("openClue"), cell }),
  z.object({ type: z.literal("judge"), team: id, correct: z.boolean() }),
  z.object({ type: z.literal("revealAnswer") }),
  z.object({ type: z.literal("closeClue") }),
  z.object({ type: z.literal("voidClue") }),
  z.object({ type: z.literal("setSelector"), team: id.nullable() }),
  z.object({ type: z.literal("finish") }),
]);

/** Running the grid needs the same role as running the buzzer and scores. */
const hostProcedure = staffProcedure("runGame");

async function control<T>(
  gameId: string,
  result: Promise<Result<T, GridModeError>>,
) {
  const outcome = await result;
  if (outcome.isErr()) throw toTRPCError(outcome.error);
  await emitUpdatedGameState({ gameId });
  return outcome.value;
}

/** Category Grid: the host's editor and controls. Players only ever get the public projection. */
export const categoryGridRouter = createTRPCRouter({
  hostView: hostProcedure.query(({ ctx }) => gridHostView(ctx.gameSession.id)),
  saveDraft: hostProcedure
    .input(z.object({ draft: z.unknown(), expectedRevision: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const result = await saveGridDraft({
        gameId: ctx.gameSession.id,
        draft: input.draft,
        expectedRevision: input.expectedRevision,
      });
      if (result.isErr()) throw toTRPCError(result.error);
      return result.value;
    }),
  discardDraft: hostProcedure.mutation(({ ctx }) =>
    control(ctx.gameSession.id, discardGridDraft(ctx.gameSession.id)),
  ),
  start: hostProcedure.mutation(({ ctx }) =>
    control(ctx.gameSession.id, startGrid(ctx.gameSession.id)),
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
        actInGrid({
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
        undoInGrid({
          gameId: ctx.gameSession.id,
          actorUserId: ctx.session.user.id,
          ...input,
        }),
      ),
    ),
  end: hostProcedure.mutation(({ ctx }) =>
    control(
      ctx.gameSession.id,
      endGrid(ctx.gameSession.id, ctx.session.user.id),
    ),
  ),
});
