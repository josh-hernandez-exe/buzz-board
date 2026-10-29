"use client";

import type { ReactNode } from "react";

import { useGameTokenData } from "@/app/_hooks/gameTokenData";
import { LiveGameStateProvider } from "@/app/_components/client/LiveGameState";
import type { PrivateGameState } from "@/types";

/**
 * Scopes this tab's tRPC requests to the page's game, then opens the page's
 * single live game-state stream for everything inside it.
 */
export function GameScope({
  gameId,
  initialState,
  children,
}: {
  gameId: string;
  initialState?: PrivateGameState;
  children: ReactNode;
}) {
  // Runs during render, before the provider's subscription starts.
  useGameTokenData({ scopeGameId: gameId });
  return (
    <LiveGameStateProvider initialState={initialState}>
      {children}
    </LiveGameStateProvider>
  );
}
