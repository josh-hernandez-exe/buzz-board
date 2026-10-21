import { randomUUID } from "node:crypto";

import { type GameFormat, type User } from "@prisma/client";
import { type Session } from "next-auth";
import { vi } from "vitest";

// Outside a Next request scope there are no cookies, so tests authenticate with
// the same x-buzz-board-* headers the browser client sends. `cookies` can be
// set per caller to simulate the shared cookie another tab left behind.
const cookieJar: { current: Record<string, string> } = vi.hoisted(() => ({
  current: {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    // Snapshot synchronously: gameAuth calls cookies() before its first await.
    const jar = { ...cookieJar.current };
    return {
      get: (name: string) =>
        jar[name] === undefined ? undefined : { name, value: jar[name] },
    };
  },
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
  /** Cookies sent with the request (shared by every tab in a browser). */
  cookies?: Record<string, string>;
  /** Client network address, as a proxy reports it (x-forwarded-for). */
  ip?: string;
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
  cookies = {},
  ip,
}: CallerOptions) {
  const headers = new Headers();
  if (gameId) headers.set("x-buzz-board-game-id", gameId);
  if (gameUserToken) headers.set("x-buzz-board-game-user-token", gameUserToken);
  if (ip) headers.set("x-forwarded-for", ip);

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

  cookieJar.current = cookies;
  const pending = gameAuth({ headers, user: session?.user });
  cookieJar.current = {};
  const gameSession = await pending;

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
      // "then" must be undefined, or `await` would treat the proxy as a promise.
      get: (_target, key) =>
        typeof key === "string" && key !== "then"
          ? proxyFor([...path, key])
          : undefined,
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
/**
 * Creates a game through the real `user.game.create` procedure.
 *
 * `teamAssignment` defaults to `choose` (players start without a team, as in
 * games created before PR05) so tests control placement explicitly; pass
 * `auto` to test automatic assignment.
 */
export async function createGame({
  format = "team",
  teams = format === "team" ? 2 : 0,
  teamAssignment = "choose",
}: {
  format?: GameFormat;
  teams?: number;
  teamAssignment?: "auto" | "choose" | "staff";
} = {}) {
  const host = await createUser();
  const game = await (
    await callerFor({ user: host })
  ).user.game.create({
    name: "Characterization Game",
    format,
    teamCount: format === "team" ? Math.max(1, teams) : undefined,
  });

  const admin = requestCaller({ gameId: game.id, user: host });
  if (format === "team" && teams === 0) {
    await db.gameTeam.deleteMany({ where: { gameId: game.id } });
  }
  if (format === "team") {
    await admin.gameAdmin.setTeamAssignment({ teamAssignment });
  }

  const gameTeams = await db.gameTeam.findMany({
    where: { gameId: game.id },
    orderBy: { index: "asc" },
  });

  return { host, game, admin, gameTeams };
}

const randomIp = () =>
  `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;

/** Joins as a guest through the real `public.joinGame` procedure. */
export async function joinAsGuest(code: string, nickname?: string) {
  // Each guest is a separate device on its own network, so ordinary tests
  // never trip the per-address join limit (rate-limit tests set `ip`).
  const joined = await requestCaller({ ip: randomIp() }).public.joinGame({
    gameCode: code,
    nickname,
  });
  const { token } = joined;
  if (!token) throw new Error("joinGame returned no participant token");
  const player = requestCaller({
    gameId: joined.gameId,
    gameUserToken: token,
  });
  return { ...joined, token, player };
}

export async function currentScores(gameId: string) {
  const state = await requestCaller({}).public.currentGameState({ gameId });
  return Object.fromEntries(state.gameTeams.map((t) => [t.id, t.score]));
}
