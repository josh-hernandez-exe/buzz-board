import type { Game } from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import { db } from "@/server/db";
import { getPublicGameState, getPrivateGameState } from "@/server/db/common";
import { getBuzzWinner } from "@/server/buzzer/buzzerService";
import { gameChangeBus } from "@/server/live/gameChangeBus";
import { GameFeed } from "@/server/live/gameFeed";
import type { PublicGameState, PrivateGameState, WhoBuzzedIn } from "@/types";

/**
 * Live state streams. Each yields an initial snapshot from PostgreSQL and a
 * fresh snapshot after every change; Redis only carries "game changed"
 * notifications (see GameChangeBus).
 */
export const liveFeeds = {
  publicGameState: new GameFeed<PublicGameState>(
    "public game state",
    gameChangeBus,
    (gameId) => getPublicGameState({ gameId }),
  ),
  privateGameState: new GameFeed<PrivateGameState>(
    "private game state",
    gameChangeBus,
    (gameId) => getPrivateGameState({ gameId }),
  ),
  /** Kept for tabs opened before PR04; current pages use `buzzWinner`. */
  whoBuzzedIn: new GameFeed<WhoBuzzedIn>(
    "who buzzed in",
    gameChangeBus,
    (gameId) => getWhoBuzzedIn(gameId),
  ),
};

/**
 * Announces a committed change to every live stream for the game, on every
 * instance. Call after the transaction commits; a publish failure is logged,
 * never reported as a failed save.
 */
export async function emitUpdatedGameState({
  gameId,
}: {
  gameId: Game["id"];
}): Promise<Result<void, Error>> {
  await gameChangeBus().notify(gameId);
  return ok();
}

async function getWhoBuzzedIn(
  gameId: Game["id"],
): Promise<Result<WhoBuzzedIn, Error>> {
  const game = await db.game.findUnique({
    where: { id: gameId },
    select: { id: true, format: true, isBuzzerListening: true },
  });
  if (!game) return err(new Error("Game not found"));

  const winner = await getBuzzWinner(gameId);
  if (!winner?.gameUserId) return ok({ game, gameUser: undefined });

  const [gameUser, gameTeam] = await Promise.all([
    db.gameUser.findUnique({
      where: { id: winner.gameUserId },
      include: { user: { select: { image: true } } },
    }),
    db.gameTeam.findUnique({
      where: { id: winner.gameTeamId },
      select: { id: true, name: true },
    }),
  ]);
  if (!gameUser) return ok({ game, gameUser: undefined });

  return ok({
    game,
    gameUser: {
      id: gameUser.id,
      name: gameUser.name,
      index: gameUser.index,
      // The team the claim was made for, even if the player moved since.
      gameTeam: gameTeam ?? { id: winner.gameTeamId, name: "Removed team" },
      image: gameUser.user?.image,
    },
  });
}
