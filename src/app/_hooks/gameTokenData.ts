"use client";

import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";

import { useCookiesNext } from "cookies-next/client";
import { updateExtraHeaders } from "@/trpc/react";

import { logger } from "@/logger";

type GameTokenData = {
  token: string | null;
  gameId: string | null;
  tokenStorage: Record<string, string>;
};

export function useGameTokenData() {
  const { getCookie, setCookie } = useCookiesNext();
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [gameTokenData, setGameTokenDataInLocalStorage] = useLocalStorage(
    "buzz-board-game-token-storage",
    {
      token: null,
      gameId: null,
      tokenStorage: {},
    } as GameTokenData,
  );

  const setHeadersFromToken = (gtd: GameTokenData) => {
    const { token, gameId } = gtd;
    let updateHeaderOpts = {};
    if (gameId) {
      updateHeaderOpts = { ...updateHeaderOpts, gameId };

      if (gameId !== getCookie("buzz-board-game-id")) {
        logger.debug(
          "useGameTokenData - setHeadersFromToken - setCookie - game-id: ",
          gameId,
        );
        setCookie("buzz-board-game-id", gameId, {
          maxAge: 86400, // 1 day expiration
        });
      }
    }
    if (token) {
      updateHeaderOpts = { ...updateHeaderOpts, gameUserToken: token };

      if (token !== getCookie("buzz-board-game-user-token")) {
        logger.debug(
          "useGameTokenData - setHeadersFromToken - setCookie - token: ",
          token,
        );
        setCookie("buzz-board-game-user-token", token, {
          maxAge: 86400, // 1 day expiration
        });
      }
    }
    updateExtraHeaders(updateHeaderOpts);
  };

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

    let updatedTokenData: GameTokenData = { ...gameTokenData };

    if (token) {
      updatedTokenData = {
        ...updatedTokenData,
        token: token,
      };
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
    }
    setGameTokenDataInLocalStorage(updatedTokenData);
    setHeadersFromToken(updatedTokenData);
  };

  if (isFirstLoad) {
    logger.debug(`useGameTokenData: setting token on first load.`);

    setHeadersFromToken(gameTokenData);
    setIsFirstLoad(false);
  }

  return [gameTokenData, setGameTokenData] as const;
}
