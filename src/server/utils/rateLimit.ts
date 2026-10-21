import { createClient } from "redis";

import { env } from "@/env";
import { logger } from "@/logger";

type RedisClient = ReturnType<typeof createClient>;

/**
 * Limits per client address. Joining is generous because a whole event can
 * share one network address (an office or venue Wi-Fi): 60 people joining
 * at once must never be blocked. Guessing codes is limited much harder.
 */
export const RATE_LIMITS = {
  /** Join and resume attempts from one address. */
  join: { limit: 300, windowSeconds: 60 },
  /** Join attempts with a code that matches no game. */
  unknownCode: { limit: 30, windowSeconds: 300 },
  /** Recovery and invitation link redemptions from one address. */
  redeemLink: { limit: 30, windowSeconds: 600 },
} as const;
export type RateLimitName = keyof typeof RATE_LIMITS;

let client: RedisClient | undefined;
/** Set once the first connection succeeds; later outages aren't waited on. */
let everReady = false;

function redis(): RedisClient {
  if (!client) {
    client = createClient({
      url: env.KV_URL,
      // Fail fast while Redis is down; limits then allow the request.
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 2_000,
        reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 5_000),
      },
    });
    client.on("error", (error) =>
      logger.warn("Redis rate-limit client error", String(error)),
    );
    client.on("ready", () => (everReady = true));
    client
      .connect()
      .catch((error) => logger.warn("Redis rate-limit connect failed", error));
  }
  return client;
}

/**
 * The client, waiting (at most `waitMs`) for its first connection. Connecting
 * happens on first use, so without this the first check after every server
 * start saw "not ready": chat refused the first message, joins skipped the
 * limit. After that, an outage is reported at once rather than waited on.
 */
async function readyRedis(waitMs = 1_000): Promise<RedisClient> {
  const connection = redis();
  if (connection.isReady || everReady) return connection;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    new Promise<void>((resolve) => connection.once("ready", () => resolve())),
    new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs))),
  ]);
  clearTimeout(timer);
  return connection;
}
/** The address a request came from, as reported by the proxy in front. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ?? headers.get("x-real-ip")?.trim() ?? "unknown";
}

/**
 * Counts one attempt and reports whether it is within the limit. If Redis is
 * unavailable the attempt is allowed: limits protect against abuse, they must
 * not stop a game.
 */
export async function takeRateLimit(
  name: RateLimitName,
  key: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { limit, windowSeconds } = RATE_LIMITS[name];
  const redisKey = `buzz-board:rate:${name}:${key}`;
  try {
    const connection = await readyRedis();
    if (!connection.isReady) return { allowed: true, retryAfterSeconds: 0 };
    const count = await connection.incr(redisKey);
    // Only the first attempt starts the window. (EXPIRE ... NX would need
    // Redis 7, which KeyDB does not support.)
    if (count === 1) await connection.expire(redisKey, windowSeconds);
    if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };
    let ttl = await connection.ttl(redisKey);
    if (ttl < 0) {
      // The expiry was lost (for example a crash between INCR and EXPIRE);
      // never let a key block forever.
      await connection.expire(redisKey, windowSeconds);
      ttl = windowSeconds;
    }
    return { allowed: false, retryAfterSeconds: ttl };
  } catch (error) {
    logger.warn(`Rate limit ${name} unavailable; allowing`, String(error));
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export type ChatAllowance =
  | { allowed: true }
  | { allowed: false; reason: "tooFast"; retryAfterSeconds: number }
  | { allowed: false; reason: "gameBusy" }
  | { allowed: false; reason: "unavailable" };

async function count(connection: RedisClient, key: string, seconds: number) {
  const value = await connection.incr(key);
  if (value === 1) await connection.expire(key, seconds);
  return value;
}

/**
 * Counts one chat message against the sender's burst and per-minute limits
 * and the game's per-second ceiling. Unlike join limits this **fails closed**:
 * if Redis is unavailable, chat sends are refused rather than unlimited.
 * Chat limits never apply to buzzing, scores or other game actions.
 */
export async function takeChatAllowance({
  gameId,
  actorKey,
  limits,
}: {
  gameId: string;
  actorKey: string;
  limits: {
    burstMessages: number;
    burstSeconds: number;
    perMinute: number;
    gamePerSecond: number;
  };
}): Promise<ChatAllowance> {
  try {
    const connection = await readyRedis();
    if (!connection.isReady) return { allowed: false, reason: "unavailable" };
    const prefix = `buzz-board:chat:${gameId}`;
    const second = Math.floor(Date.now() / 1000);
    const [burst, minute, game] = await Promise.all([
      count(connection, `${prefix}:burst:${actorKey}`, limits.burstSeconds),
      count(connection, `${prefix}:minute:${actorKey}`, 60),
      count(connection, `${prefix}:game:${second}`, 2),
    ]);
    if (game > limits.gamePerSecond)
      return { allowed: false, reason: "gameBusy" };
    if (burst > limits.burstMessages || minute > limits.perMinute) {
      const ttl = await connection.ttl(
        burst > limits.burstMessages
          ? `${prefix}:burst:${actorKey}`
          : `${prefix}:minute:${actorKey}`,
      );
      return {
        allowed: false,
        reason: "tooFast",
        retryAfterSeconds: Math.max(1, ttl),
      };
    }
    return { allowed: true };
  } catch (error) {
    logger.warn("Chat rate limit unavailable; refusing send", String(error));
    return { allowed: false, reason: "unavailable" };
  }
}
