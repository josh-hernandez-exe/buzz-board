"use client";

import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";

import { useCookiesNext } from "cookies-next/client";
import { updateExtraHeaders } from "@/trpc/react";

import { logger } from "@/utils/logger";

export function useGameUserToken(defaultGameUserToken: string = "") {
  const { setCookie } = useCookiesNext();
  const [gameUserToken, setGameUserTokenInStorage] = useLocalStorage(
    "buzz-board-game-user-token",
    defaultGameUserToken,
    {
      serializer: (value) => value,
      deserializer: (value) => value,
    },
  );

  if (gameUserToken.length > 0) {
    updateExtraHeaders({ gameUserToken });
  }

  const setGameUserToken = (token: string) => {
    logger.debug(`useGameUserToken - setGameUserToken: ${token}`);
    setGameUserTokenInStorage(token);
    updateExtraHeaders({
      gameUserToken: token,
    });
    setCookie("buzz-board-game-user-token", token, {
      maxAge: 86400, // 1 day expiration
    });
  };

  return [gameUserToken, setGameUserToken] as const;
}
