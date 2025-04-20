import { type RedisClientType } from "redis";

import type { Game, GameUser } from "@prisma/client";
import { ok, err, Result } from "neverthrow";
import { createClient } from "redis";

import { db } from "@/server/db";
import { getPublicGameState, getPrivateGameState } from "@/server/db/common";
import type { PublicGameState, PrivateGameState, WhoBuzzedIn } from "@/types";
import { createRedisChannelAsyncIterator } from "@/server/utils/asyncGenerator";

import { env } from "@/env";
import { logger } from "@/logger";

// Initialize KeyDB client
const redisClient = await createClient({
  url: env.KEYDB_URL, // Ensure this is set in your .env file
});

redisClient.on("error", (err) => {
  // You MUST listen to error events.
  // If a client doesn't have at least one error listener registered and an error occurs,
  // that error will be thrown and the Node.js process will exit.
  logger.error("Redis Client Error", err);
});

await redisClient.connect();

function cacheFactory<T>(prefix: string) {
  return {
    async set(gameId: Game["id"], data: T) {
      const key = `${prefix}:${gameId}`;
      await redisClient.set(key, JSON.stringify(data));
    },
    async get(gameId: Game["id"]): Promise<T | null> {
      const key = `${prefix}:${gameId}`;
      const data = await redisClient.get(key);
      return data ? (JSON.parse(data) as T) : null;
    },
    async has(gameId: Game["id"]): Promise<boolean> {
      const key = `${prefix}:${gameId}`;
      return (await redisClient.exists(key)) > 0;
    },
  };
}

export const gameEventCache = {
  publicGameStateUpdate: cacheFactory<PublicGameState>("publicGameStateUpdate"),
  privateGameStateUpdate: cacheFactory<PrivateGameState>(
    "privateGameStateUpdate",
  ),
  whoBuzzedIn: cacheFactory<WhoBuzzedIn | null>("whoBuzzedIn"),
};

// NOTE: Important redis pub/sub docs
//       https://redis.io/docs/manual/pubsub/

function emitterFactory<T>(prefix: string) {
  return {
    async publish(gameId: Game["id"], state: T) {
      const channel = `${prefix}:${gameId}`;

      // NOTE: publishing does not take over the client
      //       see subscription use
      await redisClient.publish(channel, JSON.stringify(state));
    },
    subscribe({
      gameId,
      signal,
    }: {
      gameId: Game["id"];
      signal?: AbortSignal;
    }) {
      const channel = `${prefix}:${gameId}`;

      return createRedisChannelAsyncIterator<T>({
        redisClient: redisClient as RedisClientType,
        channel,
        signal,
      });
    },
  };
}

export const gameEventEmitter = {
  publicGameStateUpdate: emitterFactory<PublicGameState>(
    "publicGameStateUpdate",
  ),
  privateGameStateUpdate: emitterFactory<PrivateGameState>(
    "privateGameStateUpdate",
  ),
  whoBuzzedIn: emitterFactory<WhoBuzzedIn | null>("whoBuzzedIn"),
};

export async function emitUpdatedGameState({
  gameId,
}: {
  gameId: Game["id"];
}): Promise<Result<void, Error>> {
  const [publicResult, privateResult] = await Promise.all([
    getPublicGameState({ gameId }),
    getPrivateGameState({ gameId }),
  ]);

  if (publicResult.isErr()) {
    return err(publicResult.error);
  }
  if (privateResult.isErr()) {
    return err(privateResult.error);
  }

  // Set cache BEFORE publishing new state

  await Promise.all([
    gameEventCache.publicGameStateUpdate.set(gameId, publicResult.value),
    gameEventCache.privateGameStateUpdate.set(gameId, privateResult.value),
  ]);

  await Promise.all([
    gameEventEmitter.publicGameStateUpdate.publish(gameId, publicResult.value),
    gameEventEmitter.privateGameStateUpdate.publish(
      gameId,
      privateResult.value,
    ),
  ]);

  return ok();
}

export async function updateBuzzerListeningState({
  gameId,
}: {
  gameId: Game["id"];
}) {
  const game = await db.game.findUnique({
    select: {
      id: true,
      format: true,
      isBuzzerListening: true,
    },
    where: {
      id: gameId,
    },
  });

  const data: WhoBuzzedIn = {
    game: game!,
    gameUser: undefined,
  };

  await gameEventCache.whoBuzzedIn.set(gameId, data);
  await gameEventEmitter.whoBuzzedIn.publish(gameId, data);
}

export async function emitWhoBuzzedIn({
  gameUserId,
}: {
  gameUserId?: GameUser["id"];
}): Promise<Result<void, Error>> {
  const result = await db.gameUser.findUnique({
    where: {
      id: gameUserId,
    },
    include: {
      gameTeam: {
        select: {
          id: true,
          name: true,
        },
      },
      game: {
        select: {
          id: true,
          format: true,
          isBuzzerListening: true,
        },
      },
      user: {
        select: {
          image: true,
        },
      },
    },
  });

  if (!result) {
    return err(new Error("User not found"));
  }

  const { gameTeam, game, ...gameUser } = result;

  const data: WhoBuzzedIn = {
    game,
    gameUser: {
      id: gameUser.id,
      name: gameUser.name,
      index: gameUser.index,
      gameTeam: gameTeam!,
      image: gameUser.user?.image,
    },
  };

  await gameEventCache.whoBuzzedIn.set(game.id, data);
  await gameEventEmitter.whoBuzzedIn.publish(game.id, data);

  return ok();
}
