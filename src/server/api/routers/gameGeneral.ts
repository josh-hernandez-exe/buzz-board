import {
  createTRPCRouter,
  protectedGameGeneralProcedure,
} from "@/server/api/trpc";

import { getPrivateGameState } from "@/server/db/common";
import { rosterTracker } from "@/server/live/rosterTracker";
import { withoutRoster } from "@/utils/liveRoster";
import {
  endWhenGameDeleted,
  gameDeletedError,
  liveFeeds,
} from "@/server/utils/events";
import { isStillStaff } from "@/server/staff/staffService";
import { TRPCError } from "@trpc/server";

import type { BasicGameInfo } from "@/types";
import type { db as database } from "@/server/db";

/**
 * Re-checks, before every update a live stream sends, that whoever opened it
 * may still see the game. A player's credential must still be current
 * (removal and guest recovery both replace it, keeping the player's ID); staff
 * must still hold a role. Checked per update so open streams lose access too.
 */
function streamAccess({
  db,
  gameId,
  userId,
  player,
}: {
  db: typeof database;
  gameId: string;
  userId: string | undefined;
  player: { id: string; token: string } | null | undefined;
}) {
  return async () => {
    // Deleting a game removes its players and staff too: say so instead.
    const denied = async (message: string) =>
      (await db.game.findUnique({ where: { id: gameId }, select: { id: true } }))
        ? new TRPCError({ code: "FORBIDDEN", message })
        : gameDeletedError();
    if (player) {
      const current = await db.gameUser.findUnique({
        where: { id: player.id },
        select: { removedAt: true, token: true },
      });
      if (!current || current.removedAt) {
        throw await denied("You were removed from this game.");
      }
      if (current.token !== player.token) {
        throw await denied("This player was recovered on another device.");
      }
      return;
    }
    if (userId && !(await isStillStaff(gameId, userId))) {
      throw await denied("Your role in this game was removed.");
    }
  };
}

export const gameGeneralRouter = createTRPCRouter({
  getBasicGameInfo: protectedGameGeneralProcedure.query(async ({ ctx }) => {
    const { gameSession } = ctx;

    const game = (await ctx.db.game.findUnique({
      where: { id: gameSession.id },
      select: {
        id: true,
        name: true,
        format: true,
        code: true,
      },
    })) as BasicGameInfo;

    return game;
  }),
  currentGameState: protectedGameGeneralProcedure.query(async ({ ctx }) => {
    const { id: gameId } = ctx.gameSession;

    const result = await getPrivateGameState({ gameId });
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  }),
  gameState: protectedGameGeneralProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    const gameId = ctx.gameSession.id;
    const player =
      "gameUser" in ctx.gameSession ? ctx.gameSession.gameUser : undefined;
    const checkAccess = streamAccess({
      db: ctx.db,
      gameId,
      userId: ctx.session?.user?.id,
      player,
    });
    // The roster is sent whole once, then as changes (src/utils/liveRoster.ts).
    let sentRoster: number | null = null;
    for await (const state of endWhenGameDeleted(
      liveFeeds.privateGameState.subscribe(gameId, signal),
    )) {
      await checkAccess();
      // A snapshot read before this player joined (shared reads can start a
      // moment earlier) doesn't list them yet: wait for the next one.
      if (player && !state.gameUsers[player.id]) continue;
      const roster = rosterTracker.updateFor(gameId, state, sentRoster);
      sentRoster = roster.version;
      yield withoutRoster(state, roster);
    }
  }),
  /** Superseded by `buzzWinner` in the game state; kept for older open tabs. */
  whoBuzzedIn: protectedGameGeneralProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    const gameId = ctx.gameSession.id;
    const checkAccess = streamAccess({
      db: ctx.db,
      gameId,
      userId: ctx.session?.user?.id,
      player: "gameUser" in ctx.gameSession ? ctx.gameSession.gameUser : null,
    });
    for await (const update of liveFeeds.whoBuzzedIn.subscribe(
      gameId,
      signal,
    )) {
      await checkAccess();
      yield update;
    }
  }),
});
