import { db } from "@/server/db";

/**
 * Finds the guestUser assosiated to a given token
 *
 * @param {Headers} headers - Headers of the request comming in
 * @returns {GameUser} - GameUser object if the client is
 *  autheticated with current game being played.
 */
export async function guestAuth({ headers }: { readonly headers: Headers }) {
  const guestToken = headers.get("x-buzz-board-guest-token") as
    | string
    | undefined;

  let guestUser;

  if (guestToken) {
    guestUser = await db.guestUser.findUnique({
      where: { token: guestToken },
    });
  }

  return {
    guestUser,
  };
}
