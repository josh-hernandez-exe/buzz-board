/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { HelpfulTRPCError } from "@/server/api/errors";
import { staffRoleFor } from "@/server/staff/staffService";
import { can, ROLE_LABEL, type Capability } from "@/utils/capabilities";

import { auth, gameAuth } from "@/server/auth";
import { db } from "@/server/db";
import { logger } from "@/logger";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth();
  const gameSession = await gameAuth({
    headers: opts.headers,
    user: session?.user,
  });

  return {
    ...opts,
    db,
    session,
    gameSession,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
        /** Help article path for expected errors, shown under the message. */
        help: error instanceof HelpfulTRPCError ? error.help : null,
      },
    };
  },
  sse: {
    ping: {
      // Enable periodic ping messages to keep connection alive
      enabled: true,
      // Send ping message every 2s
      intervalMs: 2_000,
    },
    client: {
      reconnectAfterInactivityMs: 3_000,
    },
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path, type }) => {
  const start = Date.now();

  // tRPC's `isDev` is also true for NODE_ENV=test; only add latency in `next dev`.
  if (t._config.isDev && process.env.NODE_ENV === "development") {
    // artificial delay in dev
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const took = Date.now() - start;
  // Every call at debug; only slow ones at info, so production logs stay
  // useful (and cheap) under load. Subscriptions report their whole life.
  if (took > 1_000 && type !== "subscription") {
    logger.info(`[TRPC] slow: ${path} took ${took}ms`);
  } else {
    logger.debug(`[TRPC] ${path} took ${took}ms`);
  }

  return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedUserProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        ...ctx,
        // infers the `session` as non-nullable
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });

export const protectedGameUserProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (
      !(
        typeof ctx?.gameSession?.id === "string" &&
        typeof ctx?.gameSession?.gameUser?.gameId === "string" &&
        // does the game id match the game of the gameUser
        ctx.gameSession.id === ctx.gameSession.gameUser.gameId
      )
    ) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Not a valid game user for this game.",
      });
    }
    return next({
      ctx: {
        ...ctx,
        gameSession: {
          ...ctx.gameSession,
          // infers the properties of game and gameUser as non-nullable
          id: ctx.gameSession.id,
          name: ctx.gameSession.name,
          code: ctx.gameSession.code,
          isBuzzerListening: ctx.gameSession.isBuzzerListening,
          data: ctx.gameSession.data,
          settings: ctx.gameSession.settings,
          format: ctx.gameSession.format,
          status: ctx.gameSession.status,
          finishedAt: ctx.gameSession.finishedAt,
          joiningOpen: ctx.gameSession.joiningOpen,
          teamAssignment: ctx.gameSession.teamAssignment,
          createdById: ctx.gameSession.createdById,
          gameUser: ctx.gameSession.gameUser,
        },
      },
    });
  });

/**
 * Any staff member of the game in scope: its owner, a co-host or a moderator.
 * The role is re-derived on every request from current membership, so a
 * removed or demoted helper loses access immediately. `ctx.staffRole` tells
 * procedures which role it is; use `staffProcedure(capability)` to require a
 * capability.
 */
export const protectedGameStaffProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    const userId = ctx.session?.user?.id;
    const gameId = ctx.gameSession?.id;
    const staffRole =
      typeof gameId === "string" && typeof userId === "string"
        ? staffRoleFor({
            createdById: ctx.gameSession.createdById,
            gameAdmin:
              ctx.gameSession.gameAdmin?.gameId === gameId
                ? ctx.gameSession.gameAdmin
                : null,
            userId,
          })
        : null;
    if (!staffRole || !ctx.session?.user || typeof gameId !== "string") {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Not a valid game admin user for this game.",
      });
    }
    return next({
      ctx: {
        ...ctx,
        staffRole,
        session: { ...ctx.session, user: ctx.session.user },
        gameSession: {
          ...ctx.gameSession,
          // infers the properties of game and gameUser as non-nullable
          id: gameId,
          name: ctx.gameSession.name,
          code: ctx.gameSession.code,
          isBuzzerListening: ctx.gameSession.isBuzzerListening,
          data: ctx.gameSession.data,
          settings: ctx.gameSession.settings,
          format: ctx.gameSession.format,
          status: ctx.gameSession.status,
          finishedAt: ctx.gameSession.finishedAt,
          joiningOpen: ctx.gameSession.joiningOpen,
          teamAssignment: ctx.gameSession.teamAssignment,
          createdById: ctx.gameSession.createdById,
          gameAdmin: ctx.gameSession.gameAdmin,
        },
      },
    });
  });

/** Staff with a specific capability from the fixed capability table. */
export function staffProcedure(capability: Capability) {
  return protectedGameStaffProcedure.use(({ ctx, next }) => {
    if (!can(ctx.staffRole, capability)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Your role (${ROLE_LABEL[ctx.staffRole]}) can't do that.`,
      });
    }
    return next();
  });
}

/** Owner or co-host: everything needed to run the game. */
export const protectedGameAdminProcedure = staffProcedure("runGame");

export const protectedGameGeneralProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.gameSession.gameAdmin && !ctx.gameSession.gameUser) {
      // neither a game admin nor a game user
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Not a valid game member for this game.",
      });
    }
    return next({
      ctx: {
        ...ctx,
        gameSession: {
          ...ctx.gameSession,
          // infers the properties of game and gameUser as non-nullable
          id: ctx.gameSession.id,
          name: ctx.gameSession.name,
          code: ctx.gameSession.code,
          isBuzzerListening: ctx.gameSession.isBuzzerListening,
          data: ctx.gameSession.data,
          settings: ctx.gameSession.settings,
          format: ctx.gameSession.format,
          status: ctx.gameSession.status,
          finishedAt: ctx.gameSession.finishedAt,
          joiningOpen: ctx.gameSession.joiningOpen,
          teamAssignment: ctx.gameSession.teamAssignment,
          createdById: ctx.gameSession.createdById,
        },
      },
    });
  });
