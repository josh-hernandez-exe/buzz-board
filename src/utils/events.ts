import EventEmitter, { on } from "node:events";

import type { Game, GameUser } from "@prisma/client";
import { LRUCache } from "typescript-lru-cache";
import { ok, err, Result } from "neverthrow";

import { db } from "@/server/db";
import { getPublicGameState, getPrivateGameState } from "@/server/db/common";
import type { PublicGameState, PrivateGameState, WhoBuzzedIn } from "@/types";

export type EventMap<T> = Record<keyof T, any[]>;

export class IterableEventEmitter<
  T extends EventMap<T>,
> extends EventEmitter<T> {
  toIterable<TEventName extends keyof T & string>(
    eventName: TEventName,
    opts?: NonNullable<Parameters<typeof on>[2]>,
  ): AsyncIterable<T[TEventName]> {
    return on(this as any, eventName, opts) as any;
  }
}

export interface GameEvents {
  publicGameStateUpdate: [gameId: Game["id"], PublicGameState];
  privateGameStateUpdate: [gameId: Game["id"], PrivateGameState];
  whoBuzzedIn: [gameId: Game["id"], WhoBuzzedIn | null];
}

export const gameEventEmitter = new IterableEventEmitter<GameEvents>();

// TODO: replace with a Redis-like service
export const gameEventCache = {
  publicGameStateUpdate: new LRUCache<
    Game["id"],
    GameEvents["publicGameStateUpdate"][1]
  >(),
  privateGameStateUpdate: new LRUCache<
    Game["id"],
    GameEvents["privateGameStateUpdate"][1]
  >(),
  whoBuzzedIn: new LRUCache<Game["id"], GameEvents["whoBuzzedIn"][1]>(),
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

  gameEventCache.publicGameStateUpdate.set(gameId, publicResult.value);
  gameEventEmitter.emit("publicGameStateUpdate", gameId, publicResult.value);

  gameEventCache.privateGameStateUpdate.set(gameId, privateResult.value);
  gameEventEmitter.emit("privateGameStateUpdate", gameId, privateResult.value);

  return ok();
}

export async function clearWhoBuzzedIn({ gameId }: { gameId: Game["id"] }) {
  gameEventCache.whoBuzzedIn.set(gameId, null);
  gameEventEmitter.emit("whoBuzzedIn", gameId, null);
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

  gameEventCache.whoBuzzedIn.set(game.id, data);
  gameEventEmitter.emit("whoBuzzedIn", game.id, data);

  return ok();
}
