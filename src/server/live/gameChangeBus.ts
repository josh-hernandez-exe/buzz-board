import { randomUUID } from "node:crypto";

import { createClient } from "redis";

import { env } from "@/env";
import { logger } from "@/logger";

type Listener = () => void;
type RedisClient = ReturnType<typeof createClient>;

/** "buzz-board:<pid>:<role>": no spaces, as Redis client names require. */
export function redisClientName(role: string) {
  return `buzz-board:${process.pid}:${role}`;
}

const CHANNEL_PREFIX = "buzz-board:game-changed:";
const INITIAL_CONNECT_WAIT_MS = 1_000;

/**
 * Cross-instance "game changed" notifications.
 *
 * Messages carry no game data, only which game changed; listeners reload
 * authoritative state from PostgreSQL. That makes lost, duplicated or
 * reordered messages harmless, and means private data never goes through
 * Redis.
 *
 * Each process holds one publisher and one subscriber connection, however
 * many browser streams are open. Changes made by this process are delivered
 * to its own listeners directly, so a single-instance deployment keeps
 * updating while Redis is down. After the subscriber reconnects, every
 * listener is refreshed because notifications may have been missed.
 */
export class GameChangeBus {
  private readonly instanceId = randomUUID();
  private readonly listeners = new Map<string, Set<Listener>>();
  private publisher?: RedisClient;
  private publisherReady?: Promise<void>;
  private subscriber?: RedisClient;
  private subscriberWasReady = false;

  constructor(private readonly redisUrl: string) {}

  /** Calls `listener` whenever `gameId` changes. Returns an unsubscribe function. */
  listen(gameId: string, listener: Listener): () => void {
    let set = this.listeners.get(gameId);
    if (!set) {
      set = new Set();
      this.listeners.set(gameId, set);
      this.getSubscriber()
        .subscribe(CHANNEL_PREFIX + gameId, (message) =>
          this.onMessage(gameId, message),
        )
        // Listeners load their first state before SUBSCRIBE is confirmed, so
        // a change made by another process in between would be missed.
        // Reload once now that every later change will be announced.
        .then(() => {
          if (this.listeners.get(gameId) === set) this.deliver(gameId);
        })
        .catch((error) =>
          logger.warn(`Could not subscribe to game ${gameId} changes`, error),
        );
    }
    set.add(listener);

    return () => {
      const current = this.listeners.get(gameId);
      if (!current?.delete(listener) || current.size > 0) return;
      this.listeners.delete(gameId);
      this.subscriber
        ?.unsubscribe(CHANNEL_PREFIX + gameId)
        .catch((error) =>
          logger.warn(`Could not unsubscribe from game ${gameId}`, error),
        );
    };
  }

  /**
   * Announces that a game's committed state changed. Never throws: a failed
   * publish is logged, and other instances catch up when their subscriber
   * reconnects or their clients reconnect.
   */
  async notify(gameId: string): Promise<void> {
    this.deliver(gameId);
    try {
      const publisher = await this.readyPublisher();
      await publisher.publish(CHANNEL_PREFIX + gameId, this.instanceId);
    } catch (error) {
      logger.warn(`Could not publish change for game ${gameId}`, error);
    }
  }

  /** Number of games this process is currently listening to. */
  get listenedGameCount(): number {
    return this.listeners.size;
  }

  /** Closes both connections immediately, including while reconnecting. */
  async close(): Promise<void> {
    for (const client of [this.publisher, this.subscriber]) {
      if (!client?.isOpen) continue;
      try {
        await client.disconnect();
      } catch (error) {
        logger.warn("Redis disconnect failed", error);
      }
    }
  }

  private onMessage(gameId: string, origin: string) {
    if (origin === this.instanceId) return;
    this.deliver(gameId);
  }

  private deliver(gameId: string) {
    for (const listener of this.listeners.get(gameId) ?? []) {
      try {
        listener();
      } catch (error) {
        logger.error(`Game ${gameId} change listener failed`, error);
      }
    }
  }

  /**
   * The publisher fails fast while disconnected so requests never hang on
   * Redis. Before its first connection completes it would also reject, which
   * silently dropped each process's first notification, so the first publish
   * waits (bounded) for the initial connection.
   */
  private async readyPublisher(): Promise<RedisClient> {
    if (!this.publisher) {
      const publisher = this.connect("publisher", {
        disableOfflineQueue: true,
      });
      this.publisher = publisher;
      this.publisherReady = new Promise<void>((resolve) => {
        publisher.once("ready", () => resolve());
      });
    }
    if (!this.publisher.isReady && this.publisherReady) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.publisherReady,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, INITIAL_CONNECT_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
    // Wait at most once per process; afterwards outages fail fast.
    this.publisherReady = undefined;
    return this.publisher;
  }

  private getSubscriber(): RedisClient {
    if (!this.subscriber) {
      const subscriber = this.connect("subscriber", {});
      subscriber.on("ready", () => {
        if (this.subscriberWasReady) {
          logger.info("Redis subscriber reconnected; refreshing live games");
          for (const gameId of this.listeners.keys()) this.deliver(gameId);
        }
        this.subscriberWasReady = true;
      });
      this.subscriber = subscriber;
    }
    return this.subscriber;
  }

  private connect(
    role: string,
    options: { disableOfflineQueue?: boolean },
  ): RedisClient {
    const client = createClient({
      url: this.redisUrl,
      // Named per process, so CLIENT LIST shows who owns each connection.
      name: redisClientName(role),
      ...options,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 5_000),
      },
    });
    // Required: an unhandled "error" event would crash the process.
    client.on("error", (error) =>
      logger.warn(`Redis ${role} error`, String(error)),
    );
    // Connecting is not awaited, so pages and requests never block on Redis.
    client
      .connect()
      .catch((error) => logger.warn(`Redis ${role} connect failed`, error));
    return client;
  }
}

const globalForBus = globalThis as unknown as {
  gameChangeBus: GameChangeBus | undefined;
};

/** The process-wide bus (one per server process, reused across dev reloads). */
export function gameChangeBus(): GameChangeBus {
  globalForBus.gameChangeBus ??= new GameChangeBus(env.KV_URL);
  return globalForBus.gameChangeBus;
}
