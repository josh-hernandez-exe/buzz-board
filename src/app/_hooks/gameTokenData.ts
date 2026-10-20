"use client";

import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";

import { useCookiesNext } from "cookies-next/client";
import { updateExtraHeaders } from "@/trpc/react";

import { logger } from "@/logger";

type GameTokenData = {
  /** Most recently used credential (pre-PR05 storage; kept for old tabs). */
  token: string | null;
  gameId: string | null;
  /** Credentials by join code, used to offer "Resume" on the join screen. */
  tokenStorage: Record<string, string>;
  /** Credentials by game ID, so each tab sends its own game's credential. */
  tokensByGame?: Record<string, string>;
};

/** Per-game cookie read by server-rendered pages (see `gameAuth`). */
export const gameTokenCookieName = (gameId: string) =>
  `buzz-board-game-user-token.${gameId}`;

const COOKIE_MAX_AGE = 86400;

/**
 * @param scopeGameId - The game this page renders (its route param). Every tab
 *   shares localStorage and cookies, so without it a reload would scope this
 *   tab's requests to whichever game was opened most recently in any tab.
 */
export function useGameTokenData({
  scopeGameId,
}: { scopeGameId?: string } = {}) {
  const { getCookie, setCookie, deleteCookie } = useCookiesNext();
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [gameTokenData, setGameTokenDataInLocalStorage] =
    useLocalStorage<GameTokenData>("buzz-board-game-token-storage", {
      token: null,
      gameId: null,
      tokenStorage: {},
    });

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
          maxAge: COOKIE_MAX_AGE,
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
          maxAge: COOKIE_MAX_AGE,
        });
      }
      if (gameId && token !== getCookie(gameTokenCookieName(gameId))) {
        setCookie(gameTokenCookieName(gameId), token, {
          maxAge: COOKIE_MAX_AGE,
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
    if (gameId && token) {
      updatedTokenData = {
        ...updatedTokenData,
        tokensByGame: { ...updatedTokenData.tokensByGame, [gameId]: token },
      };
    }
    setGameTokenDataInLocalStorage(updatedTokenData);
    setHeadersFromToken(updatedTokenData);
  };

  /**
   * "Leave this room on this device": forgets this browser's credential for
   * one game. The player's profile, team and scores stay on the server.
   */
  const leaveGame = ({ gameId, code }: { gameId: string; code?: string }) => {
    const leftToken = gameTokenData.tokensByGame?.[gameId];
    const { [gameId]: _removed, ...tokensByGame } =
      gameTokenData.tokensByGame ?? {};
    const tokenStorage = Object.fromEntries(
      Object.entries(gameTokenData.tokenStorage).filter(
        ([storedCode, token]) =>
          storedCode !== code?.toUpperCase() && token !== leftToken,
      ),
    );
    const isCurrent = gameTokenData.gameId === gameId;
    setGameTokenDataInLocalStorage({
      token: isCurrent ? null : gameTokenData.token,
      gameId: isCurrent ? null : gameTokenData.gameId,
      tokenStorage,
      tokensByGame,
    });
    deleteCookie(gameTokenCookieName(gameId));
    if (isCurrent || getCookie("buzz-board-game-id") === gameId) {
      deleteCookie("buzz-board-game-id");
      deleteCookie("buzz-board-game-user-token");
    }
    updateExtraHeaders({ gameId: null, gameUserToken: null });
  };

  if (isFirstLoad) {
    logger.debug(`useGameTokenData: setting token on first load.`);

    setHeadersFromToken(
      scopeGameId
        ? {
            ...gameTokenData,
            gameId: scopeGameId,
            // Only this game's credential; never another game's.
            token:
              gameTokenData.tokensByGame?.[scopeGameId] ??
              (gameTokenData.gameId === scopeGameId
                ? gameTokenData.token
                : null),
          }
        : gameTokenData,
    );
    setIsFirstLoad(false);
  }

  return [gameTokenData, setGameTokenData, leaveGame] as const;
}
