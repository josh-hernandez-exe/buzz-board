"use client";

import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";

import { api } from "@/trpc/react";
import type { PrivateGameState, PublicGameState } from "@/types";

export type LiveStatus = "idle" | "connecting" | "pending" | "error";

type LiveState<T> = {
  /** Latest snapshot from the stream, or the server-rendered state before it. */
  data: T | undefined;
  status: LiveStatus;
  /** True once the stream itself has delivered at least one snapshot. */
  hasLiveData: boolean;
};

const PrivateLiveState = createContext<LiveState<PrivateGameState> | null>(
  null,
);
const PublicLiveState = createContext<LiveState<PublicGameState> | null>(null);

/**
 * Opens the page's single member game-state stream. Every component on the
 * page reads it through `useLiveGameState`; opening a stream per component
 * exhausted the browser's six HTTP/1.1 connections (see docs/pr02-baseline.md).
 */
export function LiveGameStateProvider({
  initialState,
  children,
}: {
  initialState?: PrivateGameState;
  children: ReactNode;
}) {
  const subscription = api.gameGeneral.gameState.useSubscription();
  return (
    <PrivateLiveState.Provider
      value={{
        data: subscription.data ?? initialState,
        status: subscription.status,
        hasLiveData: subscription.data !== undefined,
      }}
    >
      <LiveConnectionNotice
        status={subscription.status}
        hasLiveData={subscription.data !== undefined}
        error={subscription.error}
      />
      {children}
    </PrivateLiveState.Provider>
  );
}

/** The single public stream for an anonymous display. */
export function PublicLiveGameStateProvider({
  gameId,
  initialState,
  children,
}: {
  gameId: string;
  initialState?: PublicGameState;
  children: ReactNode;
}) {
  const subscription = api.public.gameState.useSubscription({ gameId });
  return (
    <PublicLiveState.Provider
      value={{
        data: subscription.data ?? initialState,
        status: subscription.status,
        hasLiveData: subscription.data !== undefined,
      }}
    >
      <LiveConnectionNotice
        status={subscription.status}
        hasLiveData={subscription.data !== undefined}
        error={subscription.error}
      />
      {children}
    </PublicLiveState.Provider>
  );
}

export function useLiveGameState(): LiveState<PrivateGameState> {
  const value = useContext(PrivateLiveState);
  if (!value) {
    throw new Error("useLiveGameState needs a LiveGameStateProvider");
  }
  return value;
}

export function usePublicLiveGameState(): LiveState<PublicGameState> {
  const value = useContext(PublicLiveState);
  if (!value) {
    throw new Error(
      "usePublicLiveGameState needs a PublicLiveGameStateProvider",
    );
  }
  return value;
}

/** Tells people when what they see may be out of date. */
export function LiveConnectionNotice({
  status,
  hasLiveData,
  error,
}: {
  status: LiveStatus;
  hasLiveData: boolean;
  error?: { message: string; data?: { code?: string } | null } | null;
}) {
  let message: string | undefined;
  if (status === "error" && error?.data?.code === "NOT_FOUND") {
    return (
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-50 bg-gray-900 px-4 py-3 text-center text-sm font-medium text-white"
      >
        {error.message}{" "}
        <Link className="underline" href="/">
          Go to the home page
        </Link>
      </div>
    );
  }
  if (status === "error" && error?.data?.code === "FORBIDDEN") {
    message = error.message;
  } else if (status === "error") {
    message = "Live updates stopped. Reload the page to reconnect.";
  } else if (status === "connecting" && hasLiveData) {
    message = "Reconnecting… scores and buzzers may be out of date.";
  }
  if (!message) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-black"
    >
      {message}
    </div>
  );
}
