import { err, type Result } from "neverthrow";

import { logger } from "@/logger";

import { type GameChangeBus } from "./gameChangeBus";

type Sink<T> = {
  /** Only the newest snapshot is kept: state messages are full snapshots. */
  pending?: { value: T } | { error: Error };
  delivered: boolean;
  wake?: () => void;
};

type GameEntry<T> = {
  sinks: Set<Sink<T>>;
  unlisten: () => void;
  reading: boolean;
  dirty: boolean;
};

/**
 * A live view of one kind of game state (for example the public scoreboard).
 *
 * Every subscriber for a game in this process shares one loader: on each
 * change notification the state is read from PostgreSQL once and the snapshot
 * is handed to every subscriber. Reads for a game never overlap, so each
 * subscriber sees snapshots in commit order; a change that arrives during a
 * read triggers one more read afterwards. Slow subscribers only ever hold the
 * newest snapshot, so memory per subscriber is bounded.
 */
export class GameFeed<T> {
  private readonly games = new Map<string, GameEntry<T>>();

  constructor(
    private readonly name: string,
    private readonly bus: () => GameChangeBus,
    private readonly load: (gameId: string) => Promise<Result<T, Error>>,
  ) {}

  /** Yields the current state, then every later change, until `signal` aborts. */
  subscribe(gameId: string, signal?: AbortSignal): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: () => this.iterate(gameId, signal),
    };
  }

  /** Number of open subscriptions for a game in this process. */
  subscriberCount(gameId: string): number {
    return this.games.get(gameId)?.sinks.size ?? 0;
  }

  private async *iterate(
    gameId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<T, void, undefined> {
    if (signal?.aborted) return;

    const sink: Sink<T> = { delivered: false };
    const entry = this.attach(gameId, sink);
    const onAbort = () => sink.wake?.();
    signal?.addEventListener("abort", onAbort);

    try {
      void this.refresh(gameId, entry);
      for (;;) {
        if (signal?.aborted) return;
        if (!sink.pending) {
          await new Promise<void>((resolve) => (sink.wake = resolve));
          sink.wake = undefined;
        }
        if (signal?.aborted) return;
        const next = sink.pending;
        sink.pending = undefined;
        if (!next) continue;
        if ("error" in next) throw next.error;
        sink.delivered = true;
        yield next.value;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.detach(gameId, sink);
    }
  }

  private attach(gameId: string, sink: Sink<T>): GameEntry<T> {
    let entry = this.games.get(gameId);
    if (!entry) {
      const created: GameEntry<T> = {
        sinks: new Set(),
        reading: false,
        dirty: false,
        unlisten: () => undefined,
      };
      created.unlisten = this.bus().listen(gameId, () => {
        void this.refresh(gameId, created);
      });
      this.games.set(gameId, created);
      entry = created;
    }
    entry.sinks.add(sink);
    return entry;
  }

  private detach(gameId: string, sink: Sink<T>) {
    const entry = this.games.get(gameId);
    if (!entry) return;
    entry.sinks.delete(sink);
    if (entry.sinks.size === 0) {
      entry.unlisten();
      this.games.delete(gameId);
    }
  }

  private async refresh(gameId: string, entry: GameEntry<T>) {
    if (entry.reading) {
      entry.dirty = true;
      return;
    }
    entry.reading = true;
    try {
      do {
        entry.dirty = false;
        const result: Result<T, Error> = await this.load(gameId).catch(
          (error: unknown) => {
            logger.error(`Live ${this.name} load failed for ${gameId}`, error);
            return err(
              error instanceof Error ? error : new Error(String(error)),
            );
          },
        );
        for (const sink of entry.sinks) {
          if (result.isOk()) {
            sink.pending = { value: result.value };
          } else if (!sink.delivered) {
            // A subscriber that never received state cannot continue.
            sink.pending = { error: result.error };
          } else {
            logger.warn(
              `Live ${this.name} for ${gameId} is unavailable`,
              result.error.message,
            );
            continue;
          }
          sink.wake?.();
        }
      } while (entry.dirty && entry.sinks.size > 0);
    } finally {
      entry.reading = false;
    }
  }
}
