"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import SuperJSON from "superjson";

import { type AppRouter } from "@/server/api/root";
import { createQueryClient } from "./query-client";
import { logger } from "@/utils/logger";

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = () => {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return createQueryClient();
  }
  // Browser: use singleton pattern to keep the same query client
  clientQueryClientSingleton ??= createQueryClient();

  return clientQueryClientSingleton;
};

export const api = createTRPCReact<AppRouter>();

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

type extraHeaders = {
  gameId: string | null | undefined;
  guestToken: string | null | undefined;
};

const extraHeaders: extraHeaders = {
  gameId: null, // x-buzz-board-game-id
  guestToken: null, // x-buzz-board-guest-token
};

export function updateExtraHeaders({
  gameId,
  guestToken,
}: Partial<extraHeaders>) {
  if (gameId !== undefined) {
    logger.info(`Update header game id: ${gameId}`);
    extraHeaders.gameId = gameId;
  }

  if (guestToken !== undefined) {
    logger.info(`Update guest token`);
    extraHeaders.guestToken = guestToken;
  }

  logger.debug(`Current headers: ${JSON.stringify(extraHeaders, null, 2)}`);
}

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        // NOTE: need httpBatchLink to have dynamic headers
        httpBatchLink({
          transformer: SuperJSON,
          url: getBaseUrl() + "/api/trpc",
          headers: () => {
            logger.info("Building Headers");
            const headers = new Headers();
            const { gameId, guestToken } = extraHeaders;
            headers.set("x-trpc-source", "nextjs-react");
            if (gameId) {
              headers.set("x-buzz-board-game-id", gameId);
            }
            if (guestToken) {
              headers.set("x-buzz-board-guest-token", guestToken);
            }
            return headers;
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </api.Provider>
    </QueryClientProvider>
  );
}

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
