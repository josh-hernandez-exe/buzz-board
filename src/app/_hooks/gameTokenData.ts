"use client";

import { useLocalStorage } from "usehooks-ts";

import { useCookiesNext } from "cookies-next/client";
import { updateExtraHeaders } from "@/trpc/react";

import { logger } from "@/utils/logger";

export function useGameTokenData(
  {
    defaultGameUserToken = null,
    defaultGameId = null,
  }: {
    defaultGameUserToken?: string | null;
    defaultGameId?: string | null;
  } = {
    defaultGameUserToken: null,
    defaultGameId: null,
  },
) {
  const { setCookie } = useCookiesNext();
  const [gameTokenData, setGameTokenDataInLocalStorage] = useLocalStorage(
    "buzz-board-game-token-storage",
    {
      token: defaultGameUserToken,
      gameId: defaultGameId,
      tokenStorage: {} as Record<string, string>,
    },
  );
  updateExtraHeaders({
    gameUserToken: gameTokenData.token,
    gameId: gameTokenData.gameId,
  });

  const setGameTokenData = ({
    code,
    token,
    gameId,
  }: {
    code: string;
    token: string;
    gameId: string;
  }) => {
    logger.debug(`useGameTokenData - setGameUserToken: ${token}`);
    setGameTokenDataInLocalStorage({
      ...gameTokenData,
      token: token,
      gameId: gameId,
      tokenStorage: {
        ...gameTokenData.tokenStorage,
        [code]: token,
      } as Record<string, string>,
    });
    updateExtraHeaders({
      gameUserToken: token,
      gameId: gameId,
    });
    setCookie("buzz-board-game-user-token", token, {
      maxAge: 86400, // 1 day expiration
    });
    setCookie("buzz-board-game-id", gameId, {
      maxAge: 86400, // 1 day expiration
    });
  };

  return [gameTokenData, setGameTokenData] as const;
}

export function useGameIdData(defaultGameId: string | null = null) {
  const { setCookie } = useCookiesNext();
  const [gameTokenData, setGameTokenDataInLocalStorage] = useLocalStorage(
    "buzz-board-game-token-storage",
    {
      token: null,
      gameId: defaultGameId,
      tokenStorage: {} as Record<string, string>,
    },
  );
  updateExtraHeaders({
    gameId: gameTokenData.gameId,
  });

  const setGameIdData = ({ gameId }: { gameId: string }) => {
    logger.debug(`useGameIdData - setGameIdData: ${gameId}`);
    setGameTokenDataInLocalStorage({
      ...gameTokenData,
      gameId: gameId,
    });
    updateExtraHeaders({
      gameId: gameId,
    });
    setCookie("buzz-board-game-id", gameId, {
      maxAge: 86400, // 1 day expiration
    });
  };

  return [gameTokenData, setGameIdData] as const;
}
