"use client";

import { useGameTokenData } from "@/app/_hooks/gameTokenData";

/**
 * Scopes this tab's tRPC requests and subscriptions to the page's game. Render
 * it before components that query or subscribe to game data.
 */
export function GameScope({ gameId }: { gameId: string }) {
  useGameTokenData({ scopeGameId: gameId });
  return null;
}
