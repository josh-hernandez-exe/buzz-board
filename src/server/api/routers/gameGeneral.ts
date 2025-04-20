import { z } from "zod";

import {
  createTRPCRouter,
  protectedGameGeneralProcedure,
} from "@/server/api/trpc";

import { getPrivateGameState } from "@/server/db/common";
import { gameEventEmitter, gameEventCache } from "@/server/utils/events";

import type { BasicGameInfo } from "@/types";

import { logger } from "@/logger";

export const gameGeneralRouter = createTRPCRouter({
  getBasicGameInfo: protectedGameGeneralProcedure.query(({ ctx }) => {
    const { gameSession } = ctx;
    const game = ctx.db.game.findUnique({
      where: { id: gameSession.id },
      select: {
        id: true,
        name: true,
        format: true,
        code: true,
      },
    }) as any as BasicGameInfo;

    return game;
  }),
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

    let gameState = await gameEventCache.privateGameStateUpdate.get(gameId);
    if (!gameState) {
      const result = await getPrivateGameState({ gameId });
      if (result.isErr()) {
        throw result.error;
      }
      gameState = result.value;
    }

    yield gameState;

    for await (const gameState of gameEventEmitter.privateGameStateUpdate.subscribe(
      { gameId, signal },
    )) {
      yield gameState;
    }
  }),
  whoBuzzedIn: protectedGameGeneralProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    const game = ctx.gameSession;

    let whoBuzzedIn = await gameEventCache.whoBuzzedIn.get(game.id);
    if (whoBuzzedIn) {
      yield whoBuzzedIn;
    }

    for await (const whoBuzzedIn of gameEventEmitter.whoBuzzedIn.subscribe({
      gameId: game.id,
      signal,
    })) {
      yield whoBuzzedIn;
    }
  }),
});
