import EventEmitter, { on } from "node:events";

import type { Game, GameUser } from "@prisma/client";
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

// TODO: replace with a Redis-like service
export const gameEventEmitter = new IterableEventEmitter<GameEvents>();

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

  gameEventEmitter.emit("publicGameStateUpdate", gameId, publicResult.value);
  gameEventEmitter.emit("privateGameStateUpdate", gameId, privateResult.value);

  return ok();
}

export async function clearWhoBuzzedIn({ gameId }: { gameId: Game["id"] }) {
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

  gameEventEmitter.emit("whoBuzzedIn", game.id, data);

  return ok();
}
