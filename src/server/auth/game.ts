import type { Game, GameAdmin, GameUser } from "@prisma/client";
import { cookies } from "next/headers";

import { db } from "@/server/db";
import { logger } from "@/logger";

/**
 * Finds if the client is a user for the current game.
 *
 * @param {string} gameId - ID of the game
 * @param {string} gameUserToken - token of the game user
 * @returns {GameUser} - GameUser object if the client is
 *  autheticated with current game being played.
 *
 * @remarks
 * This function relies on the NextAuth process to find the
 * an actual authenticated user.
 */
async function gameUserAuth({
  gameId,
  gameUserToken,
}: {
  gameId: string | undefined;
  gameUserToken: string | undefined;
}): Promise<{ gameUser: GameUser | undefined | null }> {
  let gameUser;

  if (!gameId || !gameUserToken) {
    logger.debug("No game token given");
    return { gameUser };
  }

  gameUser = await db.gameUser.findUnique({
    where: {
      token: gameUserToken,
    },
  });

  if (gameUser && gameUser.gameId !== gameId) {
    logger.warn("Game User found is not for the current game.");
    gameUser = null;
  }

  if (gameUser?.removedAt) {
    logger.warn("Game User was removed from this game.");
    gameUser = null;
  }

  // Signing in never links a guest player to the account; the player links
  // explicitly (identityService.linkPlayerToAccount).
  return {
    gameUser,
  };
}

/**
 * Finds if the current user is an admin for the current game
 *
 * @param {string} gameId - ID of the game
 * @param {User?} user - authenticated User object from NextAuth
 * @returns {GameAdmin} - GameAdmin object if the current user
 *  is an admin for the current game.
 *
 * @remarks
 * This function relies on the NextAuth process to find the
 * an actual authenticated user.
 */
async function gameAdminAuth({
  gameId,
  user,
}: {
  gameId: string | undefined;
  user?: { id: string };
}): Promise<{ gameAdmin: GameAdmin | undefined | null }> {
  if (!user?.id || !gameId) return { gameAdmin: undefined };
  // Most requests come from players, who have no staff row: that's normal.
  const gameAdmin = await db.gameAdmin.findUnique({
    where: { userId_gameId: { gameId, userId: user.id } },
  });

  return {
    gameAdmin,
  };
}

type GameAuthReturn = Game & {
  gameAdmin: GameAdmin | undefined | null;
  gameUser: GameUser | undefined | null;
};

/**
 * Find any game user info
 *
 * @param {Headers} headers - Headers of the request comming in
 * @param {User?} user - authenticated User object from NextAuth
 * @returns {GameUser} - GameUser object if the client is
 *  autheticated with current game being played.
 *
 * @remarks
 * This function relies on the NextAuth process to find the
 * an actual authenticated user.
 */
export async function gameAuth({
  headers,
  user,
  gameId: explicitGameId,
}: {
  headers: Headers;
  user?: { id: string };
  /** The game a server page is rendering (its route param). Always wins. */
  gameId?: string;
}): Promise<GameAuthReturn | Record<string, never>> {
  const cookieStore = await cookies();

  // Scope precedence: explicit route game, then the per-tab headers sent by the
  // tRPC client, then the shared cookies. Cookies are last because every tab
  // shares them, so they only describe the most recently opened game.
  const gameId =
    explicitGameId ??
    headers.get("x-buzz-board-game-id") ??
    cookieStore.get("buzz-board-game-id")?.value;
  // A per-game cookie lets a server-rendered page find this game's player
  // credential even after the browser joined another game in another tab.
  const gameUserToken =
    headers.get("x-buzz-board-game-user-token") ??
    cookieStore.get(`buzz-board-game-user-token.${gameId}`)?.value ??
    cookieStore.get("buzz-board-game-user-token")?.value;

  if (!gameId) {
    logger.debug("No game ID found during auth.");
    return {};
  }

  const game = await db.game.findUnique({ where: { id: gameId } });

  if (!game) {
    logger.warn("Game not found during auth.");
    return {};
  }

  const [{ gameUser }, { gameAdmin }] = await Promise.all([
    gameUserAuth({
      gameId,
      gameUserToken: gameUserToken ?? undefined,
    }),
    gameAdminAuth({
      gameId,
      user,
    }),
  ]);

  return {
    ...game,
    gameAdmin,
    gameUser,
  };
}
