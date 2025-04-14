import type { Game } from "@prisma/client";

import EventEmitter, { on } from "node:events";

import type { PublicGameState, PrivateGameState } from "@/types";

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
}

// TODO: replace with a Redis-like service
export const gameEventEmitter = new IterableEventEmitter<GameEvents>();
