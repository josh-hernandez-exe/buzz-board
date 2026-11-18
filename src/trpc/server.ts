import "server-only";

import { createHydrationHelpers } from "@trpc/react-query/rsc";
import { headers } from "next/headers";
import { cache } from "react";

import { inertCaller } from "@/server/api/inertCaller";
import { createCaller, type AppRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { createQueryClient } from "./query-client";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");

  return createTRPCContext({
    headers: heads,
  });
});

const getQueryClient = cache(createQueryClient);
const caller = createCaller(createContext);

export const { trpc: api, HydrateClient } = createHydrationHelpers<AppRouter>(
  caller,
  getQueryClient,
);

/**
 * A server-side caller scoped to one game, for pages under /game/[gameId].
 * The generic `api` caller would fall back to the shared game cookie, which
 * belongs to whichever game was opened most recently in any tab.
 */
export const gameApi = cache(async (gameId: string) => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");
  heads.set("x-buzz-board-game-id", gameId);

  return inertCaller(createCaller(await createTRPCContext({ headers: heads })));
});
