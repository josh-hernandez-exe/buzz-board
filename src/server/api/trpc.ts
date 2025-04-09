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

import { auth, guestAuth, gameAuth } from "@/server/auth";
import { db } from "@/server/db";

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
  const guestSession = await guestAuth({ headers: opts.headers });
  const game = await gameAuth({
    headers: opts.headers,
    user: session?.user,
    guestUser: guestSession.guestUser,
  });

  return {
    ...opts,
    db,
    session,
    guestSession,
    game,
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
      },
    };
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
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // artificial delay in dev
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

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
        typeof ctx?.game?.id === "string" &&
        typeof ctx?.game?.gameUser?.gameId === "string" &&
        // does the game id match the game of the gameUser
        ctx.game.id === ctx.game.gameUser.gameId &&
        // is the game user associated with the currently authed user
        ((typeof ctx?.session?.user.id === "string" &&
          ctx.game.gameUser.userId === ctx.session.user.id) ||
          // or is the game user associated with a guest user
          (typeof ctx?.guestSession?.guestUser?.id === "string" &&
            ctx.game.gameUser.guestUserId === ctx.guestSession.guestUser.id))
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
        game: {
          ...ctx.game,
          // infers the properties of game and gameUser as non-nullable
          id: ctx.game.id,
          name: ctx.game.name,
          code: ctx.game.code,
          settings: ctx.game.settings,
          format: ctx.game.format,
          gameUser: ctx.game.gameUser,
        },
      },
    });
  });

export const protectedGameAdmintProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (
      !(
        typeof ctx?.game?.id === "string" &&
        typeof ctx?.game?.gameAdmin?.gameId === "string" &&
        typeof ctx.session?.user?.id === "string" &&
        // does the game id match game of the gameAdmin
        ctx.game.id === ctx.game.gameAdmin.gameId &&
        // does the gameAdmin associated with the authed in user
        ctx.game.gameAdmin.userId === ctx.session.user.id
      )
    ) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Not a valid game admin user for this game.",
      });
    }
    return next({
      ctx: {
        ...ctx,
        game: {
          ...ctx.game,
          // infers the properties of game and gameUser as non-nullable
          id: ctx.game.id,
          name: ctx.game.name,
          code: ctx.game.code,
          settings: ctx.game.settings,
          format: ctx.game.format,
          gameAdmin: ctx.game.gameAdmin,
        },
      },
    });
  });
