import type { Game, GameAdmin, GameUser, User } from "@prisma/client";
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
  user,
}: {
  gameId: string | undefined;
  gameUserToken: string | undefined;
  user?: Pick<User, "id"> | undefined;
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

  if (
    typeof user?.id === "string" &&
    gameUser &&
    gameUser?.userId !== user.id
  ) {
    // user is authed and game user is authed and not linked
    // link them
    gameUser = await db.gameUser.update({
      where: {
        id: gameUser.id,
      },
      data: {
        userId: user.id,
      },
    });
  }

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

  if (
    !(
      gameAdmin !== null &&
      gameAdmin !== undefined &&
      gameAdmin?.gameId === gameId &&
      gameAdmin?.userId === user?.id
    )
  ) {
    logger.warn("Game Admin found is not for the current game.");
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
  let gameUserToken;
  let gameId;
  const cookieStore = await cookies();

  // check cookie for server side request processing
  // or check headers for client side request

  gameUserToken ??= cookieStore.get("buzz-board-game-user-token")?.value;
  gameUserToken ??= headers.get("x-buzz-board-game-user-token") as
    | string
    | undefined;

  gameId ??= cookieStore.get("buzz-board-game-id")?.value;
  gameId ??= headers.get("x-buzz-board-game-id") as string | undefined;

  if (!gameId) {
    logger.debug("No game ID found during auth.");
    return {};
  }

  const [{ gameUser }, { gameAdmin }] = await Promise.all([
    gameUserAuth({
      gameId,
      gameUserToken,
      user,
    }),
    gameAdminAuth({
      gameId,
      user,
    }),
  ]);

  const game = await db.game.findUnique({ where: { id: gameId } });

  if (game === undefined) {
    logger.warn("Game not found during auth.");
    return {};
  }

  return {
    ...game,
    gameAdmin,
    gameUser,
  } as GameAuthReturn;
}
