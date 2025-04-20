import { type RedisClientType } from "redis";

import { logger } from "@/logger";

/**
 * Creates an async iterator for a Redis/KeyDB channel with support for an abort signal.
 *
 * @param redisClient - The Redis client instance
 * @param channel - The name of the Redis/KeyDB channel to subscribe to
 * @param signal - An optional AbortSignal to handle cancellation
 * @returns An async iterator to consume messages from the channel
 */
export function createRedisChannelAsyncIterator<T>({
  redisClient,
  channel,
  signal,
}: {
  redisClient: RedisClientType;
  channel: string;
  signal?: AbortSignal;
}): AsyncIterable<T> {
  const messages: T[] = [];

  // Using RESP2, Pub/Sub "takes over" the connection
  // (a client with subscriptions will not execute commands),
  // therefore it requires a dedicated connection.
  const subscriber = redisClient.duplicate();

  subscriber.on("error", (err) => logger.error(err)).connect();

  const iterator = {
    next: async (): Promise<IteratorResult<T>> => {
      if (messages.length > 0) {
        return { done: false, value: messages.shift() as T };
      }

      return new Promise((resolve, reject) => {
        const listener = (message: string) => {
          messages.push(JSON.parse(message));
          resolve({ done: false, value: messages.shift() as T });
          cleanUp();
        };

        const onAbort = () => {
          cleanUp();
          reject(new Error("Aborted"));
        };

        const cleanUp = () => {
          subscriber.unsubscribe(channel, listener);
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
        };

        subscriber.subscribe(channel, listener);

        if (signal) {
          signal.addEventListener("abort", onAbort);
        }
      });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return iterator;
}
