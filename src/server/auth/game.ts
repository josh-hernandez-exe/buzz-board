import type { Game, GameAdmin, GameUser } from "@prisma/client";

import { ok, err } from "neverthrow";

import { db } from "@/server/db";
import { logger } from "@/utils/logger";

async function findGameUserFromGuestUser({
  guestUser,
  gameId,
}: {
  readonly guestUser: { id: string };
  readonly gameId: string;
}) {
  const gameUser = await db.gameUser.findFirst({
    where: {
      gameId,
      userId: null,
      guestUserId: guestUser.id,
    },
  });

  if (gameUser) {
    return ok(gameUser);
  } else {
    return err(new Error("GameUser not found."));
  }
}

async function findGameUserFromUser({
  user,
  gameId,
}: {
  readonly user: { id: string };
  readonly gameId: string;
}) {
  const gameUser = await db.gameUser.findFirst({
    where: {
      gameId,
      userId: user.id,
      guestUserId: null,
    },
  });

  if (gameUser) {
    return ok(gameUser);
  } else {
    return err(new Error("GameUser not found."));
  }
}

async function syncronizeGameUser({
  user,
  guestUser,
  gameUserFromUser,
  gameUserFromGuestUser,
}: {
  readonly user: { id: string };
  readonly guestUser: { id: string };
  readonly gameUserFromUser: {
    id: string;
    userId: string | null;
    guestUserId: string | null;
  };
  readonly gameUserFromGuestUser: {
    id: string;
    userId: string | null;
    guestUserId: string | null;
  };
}) {
  const queryTransactions = [];

  if (gameUserFromUser.id === gameUserFromGuestUser.id) {
    // do nothing
    // the gameUser found in both methods match
    return ok(gameUserFromUser);
  }
  if (
    gameUserFromUser?.guestUserId &&
    gameUserFromUser.guestUserId !== gameUserFromGuestUser.guestUserId
  ) {
    // guest users don't match. remove guest user not found
    // through current token.
    const guestUserIdToDelete = gameUserFromUser.guestUserId;

    queryTransactions.push(
      db.gameUser.update({
        where: { id: gameUserFromUser.id },
        data: {
          guestUserId: null,
        },
      }),
      db.guestUser.delete({ where: { id: guestUserIdToDelete } }),
    );
  }

  // Delete gameUser found from guest
  queryTransactions.push(
    db.gameUser.delete({
      where: { id: gameUserFromGuestUser.id },
    }),
    db.gameUser.update({
      where: { id: gameUserFromUser.id },
      data: {
        // override previous data with the current
        userId: user.id,
        guestUserId: guestUser.id,
      },
    }),
  );

  const transactionResults = await db.$transaction(queryTransactions);

  return ok(transactionResults.at(-1));
}

/**
 * Finds if the client is a user for the current game.
 *
 * @param {Headers} headers - Headers of the request comming in
 * @param {User?} user - authenticated User object from NextAuth
 * @param {GuestUser?} guestUser - authenticated GuestUser object from token
 * @returns {GameUser} - GameUser object if the client is
 *  autheticated with current game being played.
 *
 * @remarks
 * This function relies on the NextAuth process to find the
 * an actual authenticated user.
 */
async function gameUserAuth({
  headers,
  user,
  guestUser,
}: {
  headers: Headers;
  user?: { id: string };
  guestUser?: { id: string } | null;
}): Promise<{ gameUser: GameUser | undefined | null }> {
  const gameId = headers.get("x-buzz-board-game-id") as string | undefined;

  let gameUser = null;
  let gameUserFromUser;
  let gameUserFromGuestUser;
  let result;

  if (user?.id && gameId) {
    result = await findGameUserFromUser({ user, gameId });

    if (result.isOk()) {
      gameUserFromUser = result.value;
      gameUser = gameUserFromUser;
    }
  }

  if (
    // if the required info is avilable to find a gameUser
    // based off a guestUser
    guestUser &&
    gameId &&
    // and there is no current gameUser found
    // or the current gameUser doesn't match
    (!gameUser || gameUser?.guestUserId !== guestUser.id)
  ) {
    result = await findGameUserFromGuestUser({ guestUser, gameId });

    if (result.isOk()) {
      gameUserFromGuestUser = result.value;
    }
  }

  if (gameUserFromUser) {
    // we have found a gameUser from the authed user
    // prioritize this gameUser.
    gameUser = gameUserFromUser;
  } else if (gameUserFromGuestUser) {
    gameUser = gameUserFromGuestUser;
  } else {
    // no gameuser found
    gameUser = null;
  }

  if (
    // all relavent objects are found
    user &&
    guestUser &&
    gameUserFromUser &&
    gameUserFromGuestUser
  ) {
    result = await syncronizeGameUser({
      user,
      guestUser,
      gameUserFromUser,
      gameUserFromGuestUser,
    });
    if (result.isOk()) {
      // update game user information
      gameUser = result.value as typeof gameUserFromUser;
    }
  }

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
      gameAdmin?.gameId !== gameId &&
      gameAdmin?.userId !== user?.id
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
 * @param {GuestUser?} guestUser - authenticated GuestUser object from token
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
  guestUser,
}: {
  headers: Headers;
  user?: { id: string };
  guestUser?: { id: string } | null;
}): Promise<GameAuthReturn | Record<string, never>> {
  const gameId = headers.get("x-buzz-board-game-id") as string | undefined;

  if (gameId === undefined || gameId === null) {
    return {};
  }

  const [{ gameUser }, { gameAdmin }] = await Promise.all([
    gameUserAuth({
      headers,
      user,
      guestUser,
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
