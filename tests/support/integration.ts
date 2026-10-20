import { randomUUID } from "node:crypto";

import { type GameFormat, type User } from "@prisma/client";
import { type Session } from "next-auth";
import { vi } from "vitest";

// `gameAuth` reads cookies first and falls back to request headers. Outside a
// Next request scope there are no cookies, so tests authenticate with the same
// x-buzz-board-* headers the browser client sends.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { db } = await import("@/server/db");
const { gameAuth } = await import("@/server/auth/game");
const { createCaller } = await import("@/server/api/root");

export { db };

type CallerOptions = {
  gameId?: string;
  gameUserToken?: string;
  user?: Pick<User, "id" | "name" | "email" | "image">;
  /** Aborts subscriptions, like a browser closing its SSE connection. */
  signal?: AbortSignal;
};

/**
 * Builds the same context shape as `createTRPCContext`, but with an explicit
 * NextAuth session instead of reading one from a request cookie.
 */
export async function callerFor({
  gameId,
  gameUserToken,
  user,
  signal,
}: CallerOptions) {
  const headers = new Headers();
  if (gameId) headers.set("x-buzz-board-game-id", gameId);
  if (gameUserToken) headers.set("x-buzz-board-game-user-token", gameUserToken);

  const session: Session | null = user
    ? {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }
    : null;

  const gameSession = await gameAuth({
    headers,
    user: session?.user,
  });

  return createCaller({ headers, db, session, gameSession }, { signal });
}

type Caller = Awaited<ReturnType<typeof callerFor>>;

/**
 * A caller whose every procedure call resolves a new context, like a separate
 * HTTP request. Plain callers snapshot game state (e.g. `isBuzzerListening`,
 * team membership) when created, which would make multi-step tests stale.
 */
export function requestCaller(options: CallerOptions): Caller {
  const proxyFor = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) =>
        typeof key === "string" ? proxyFor([...path, key]) : undefined,
      apply: async (_target, _thisArg, args: unknown[]) => {
        let node: unknown = await callerFor(options);
        for (const key of path) {
          node = (node as Record<string, unknown>)[key];
        }
        return (node as (...a: unknown[]) => unknown)(...args);
      },
    });
  return proxyFor([]) as Caller;
}

export async function createUser(name = "Test Host") {
  return db.user.create({
    data: { name, email: `${randomUUID()}@example.test` },
  });
}

/** Creates a game through the real `user.game.create` procedure. */
export async function createGame({
  format = "team",
  teams = format === "team" ? 2 : 0,
}: { format?: GameFormat; teams?: number } = {}) {
  const host = await createUser();
  const game = await (
    await callerFor({ user: host })
  ).user.game.create({
    name: "Characterization Game",
    format,
  });

  const admin = requestCaller({ gameId: game.id, user: host });
  for (let i = 0; i < teams; i++) {
    await admin.gameAdmin.addTeam();
  }

  const gameTeams = await db.gameTeam.findMany({
    where: { gameId: game.id },
    orderBy: { index: "asc" },
  });

  return { host, game, admin, gameTeams };
}

/** Joins as a guest through the real `public.joinGame` procedure. */
export async function joinAsGuest(code: string) {
  const joined = await requestCaller({}).public.joinGame({ gameCode: code });
  const player = requestCaller({
    gameId: joined.gameId,
    gameUserToken: joined.token,
  });
  return { ...joined, player };
}

export async function currentScores(gameId: string) {
  const state = await requestCaller({}).public.currentGameState({ gameId });
  return Object.fromEntries(state.gameTeams.map((t) => [t.id, t.score]));
}
