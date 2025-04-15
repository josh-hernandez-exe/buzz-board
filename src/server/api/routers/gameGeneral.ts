import { z } from "zod";

import {
  createTRPCRouter,
  protectedGameGeneralProcedure,
} from "@/server/api/trpc";

import { getPrivateGameState } from "@/server/db/common";
import { gameEventEmitter } from "@/utils/events";

import { logger } from "@/utils/logger";

export const gameGeneralRouter = createTRPCRouter({
  currentGameState: protectedGameGeneralProcedure.query(async ({ ctx }) => {
    const { id: gameId } = ctx.gameSession;

    const result = await getPrivateGameState({ gameId });
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  }),
  gameState: protectedGameGeneralProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    const { id: gameId } = ctx.gameSession;

    const result = await getPrivateGameState({ gameId });
    if (result.isErr()) {
      throw result.error;
    }

    yield result.value;

    for await (const [eventGameId, gameState] of gameEventEmitter.toIterable(
      "privateGameStateUpdate",
      { signal },
    )) {
      if (eventGameId === gameId) {
        yield gameState;
      }
    }
  }),
  whoBuzzedIn: protectedGameGeneralProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    const game = ctx.gameSession;

    for await (const [
      eventGameId,
      whoBuzzedInData,
    ] of gameEventEmitter.toIterable("whoBuzzedIn", { signal })) {
      if (eventGameId === game.id) {
        yield whoBuzzedInData;
      }
    }
  }),
});
