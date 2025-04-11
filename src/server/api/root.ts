import { userRouter } from "@/server/api/routers/user";
import { gameAdminRouter } from "@/server/api/routers/gameAdmin";
import { gameUserRouter } from "@/server/api/routers/gameUser";
import { guestRouter } from "@/server/api/routers/guest";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  user: userRouter,
  guest: guestRouter,
  gameUser: gameUserRouter,
  gameAdmin: gameAdminRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
