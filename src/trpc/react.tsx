"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  httpBatchLink,
  httpSubscriptionLink,
  loggerLink,
  splitLink,
} from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import SuperJSON from "superjson";
import { EventSourcePolyfill } from "event-source-polyfill";

import { type AppRouter } from "@/server/api/root";
import { createQueryClient } from "./query-client";
import { logger } from "@/logger";

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
  gameUserToken: string | null | undefined;
};

const extraHeaders: extraHeaders = {
  gameId: null, // x-buzz-board-game-id
  gameUserToken: null, // x-buzz-board-game-user-token
};

export function updateExtraHeaders({
  gameId,
  gameUserToken,
}: Partial<extraHeaders>) {
  if (gameId !== undefined && gameId !== extraHeaders.gameId) {
    logger.info(`Update header game id: ${gameId}`);
    extraHeaders.gameId = gameId;
  }

  if (
    gameUserToken !== undefined &&
    gameUserToken !== extraHeaders.gameUserToken
  ) {
    logger.info(`Update GameUser token`);
    extraHeaders.gameUserToken = gameUserToken;
  }
  if (gameId || gameUserToken) {
    logger.debug(`Updated headers: ${JSON.stringify(extraHeaders, null, 2)}`);
  }
}

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  const buildHeaders = () => {
    logger.info("Building Headers");
    const headers = new Headers();
    const { gameId, gameUserToken } = extraHeaders;
    headers.set("x-trpc-source", "nextjs-react");
    if (gameId) {
      headers.set("x-buzz-board-game-id", gameId);
    }
    if (gameUserToken) {
      headers.set("x-buzz-board-game-user-token", gameUserToken);
    }
    return headers;
  };

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        splitLink({
          // uses the httpSubscriptionLink for subscriptions
          condition: (op) => op.type === "subscription",
          true: httpSubscriptionLink({
            transformer: SuperJSON,
            url: getBaseUrl() + "/api/trpc",
            // polyfill is needed for custom headers
            EventSource: EventSourcePolyfill,
            eventSourceOptions: async () => {
              const headers = buildHeaders();
              return {
                headers: {
                  "x-buzz-board-game-id": headers.get("x-buzz-board-game-id")!,
                  "x-buzz-board-game-user-token": headers.get(
                    "x-buzz-board-game-user-token",
                  )!,
                },
              };
            },
          }),
          // NOTE: need httpBatchLink to have dynamic headers
          false: httpBatchLink({
            transformer: SuperJSON,
            url: getBaseUrl() + "/api/trpc",
            headers: buildHeaders,
          }),
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
