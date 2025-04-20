"use client";

import { useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";

import { useCookiesNext } from "cookies-next/client";
import { updateExtraHeaders } from "@/trpc/react";

import { logger } from "@/utils/logger";

type GameTokenData = {
  token: string | null;
  gameId: string | null;
  tokenStorage: Record<string, string>;
};

export function useGameTokenData() {
  const { setCookie } = useCookiesNext();
  const [gameTokenData, setGameTokenDataInLocalStorage] = useLocalStorage(
    "buzz-board-game-token-storage",
    {
      token: null,
      gameId: null,
      tokenStorage: {},
    } as GameTokenData,
  );

  // Memoize gameTokenData to prevent unnecessary rerenders
  const memoizedGameTokenData = useMemo(() => gameTokenData, [gameTokenData]);

  logger.debug(
    `useGameTokenData - gameTokenData: ${JSON.stringify(memoizedGameTokenData, null, 2)}`,
  );

  const setGameTokenData = ({
    code,
    token,
    gameId,
  }: {
    code?: string;
    token?: string;
    gameId?: string;
  }) => {
    logger.debug(
      `useGameTokenData - setGameUserToken: ${JSON.stringify({ code, token, gameId })}`,
    );

    let updatedTokenData: GameTokenData = { ...memoizedGameTokenData };
    let updateHeaderOpts = {};

    if (token) {
      updatedTokenData = {
        ...updatedTokenData,
        token: token,
      };
      updateHeaderOpts = { ...updateHeaderOpts, gameUserToken: token };
      setCookie("buzz-board-game-user-token", token, {
        maxAge: 86400, // 1 day expiration
      });
    }
    if (token && code) {
      updatedTokenData = {
        ...updatedTokenData,
        tokenStorage: {
          ...updatedTokenData.tokenStorage,
          [code]: token,
        },
      };
    }
    if (gameId) {
      updatedTokenData = {
        ...updatedTokenData,
        gameId: gameId,
      };
      updateHeaderOpts = { ...updateHeaderOpts, gameId };
      setCookie("buzz-board-game-id", gameId, {
        maxAge: 86400, // 1 day expiration
      });
    }
    setGameTokenDataInLocalStorage(updatedTokenData);
    updateExtraHeaders(updateHeaderOpts);
  };

  return [gameTokenData, setGameTokenData] as const;
}
