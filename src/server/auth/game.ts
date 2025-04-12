import type { Game, GameAdmin, GameUser } from "@prisma/client";

import { ok, err } from "neverthrow";

import { db } from "@/server/db";
import { logger } from "@/utils/logger";

/**
 * Finds if the client is a user for the current game.
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
async function gameUserAuth({
  headers,
}: {
  headers: Headers;
  user?: { id: string };
}): Promise<{ gameUser: GameUser | undefined | null }> {
  const gameId = headers.get("x-buzz-board-game-id") as string | undefined;
  const gameUserToken = headers.get("x-buzz-board-game-user-token") as
    | string
    | undefined;

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

  return {
    gameUser,
  };
}

/**
 * Finds if the current user is an admin for the current game
 *
 * @param {Headers} headers - Headers of the request comming in
 * @param {User?} user - authenticated User object from NextAuth
 * @returns {GameAdmin} - GameAdmin object if the current user
 *  is an admin for the current game.
 *
 * @remarks
 * This function relies on the NextAuth process to find the
 * an actual authenticated user.
 */
async function gameAdminAuth({
  headers,
  user,
}: {
  headers: Headers;
  user?: { id: string };
}): Promise<{ gameAdmin: GameAdmin | undefined | null }> {
  const gameId = headers.get("x-buzz-board-game-id") as string | undefined;

  let gameAdmin;

  if (user?.id && gameId) {
    gameAdmin = await db.gameAdmin.findUnique({
      where: {
        // @@unique([userId, gameId])
        userId_gameId: {
          gameId,
          userId: user.id,
        },
      },
      include: { game: true },
    });
  }

  logger.info(JSON.stringify(gameAdmin, null, 2));

  if (
    !(
      gameAdmin !== null &&
      gameAdmin !== undefined &&
      gameAdmin?.gameId === gameId &&
      gameAdmin?.userId === user?.id
    )
  ) {
    gameAdmin = undefined;
  }

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
}: {
  headers: Headers;
  user?: { id: string };
}): Promise<GameAuthReturn | Record<string, never>> {
  const gameId = headers.get("x-buzz-board-game-id") as string | undefined;
  if (gameId === undefined || gameId === null) {
    return {};
  }

  const [{ gameUser }, { gameAdmin }] = await Promise.all([
    gameUserAuth({
      headers,
      user,
    }),
    gameAdminAuth({
      headers,
      user,
    }),
  ]);

  const game = await db.game.findUnique({ where: { id: gameId } });

  if (game === undefined) {
    return {};
  }

  return {
    ...game,
    gameAdmin,
    gameUser,
  } as GameAuthReturn;
}
