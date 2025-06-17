/**
 * Vanilla tRPC client that can be used without React
 * This makes HTTP requests to your tRPC endpoints
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";
import type { AppRouter } from "@/server/api/root";

import { getBaseUrl } from "./utils";

export const createVanillaTrpcClient = (options?: {
  gameId?: string;
  gameUserToken?: string;
  authorization?: string;
}) => {
  const buildHeaders = () => {
    const { gameId, gameUserToken, authorization } = options ?? {};
    const headers: Record<string, string> = {
      "x-trpc-source": "vanilla-client",
    };

    if (gameId) {
      headers["x-buzz-board-game-id"] = gameId;
    }
    if (gameUserToken) {
      headers["x-buzz-board-game-user-token"] = gameUserToken;
    }
    if (authorization) {
      headers.authorization = authorization;
    }

    console.log("TRPC Headers:", headers);

    return headers;
  };

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${getBaseUrl()}/api/trpc`,
        transformer: SuperJSON,
        headers: buildHeaders,
      }),
    ],
  });
};
