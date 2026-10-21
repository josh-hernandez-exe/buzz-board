import type { Game } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { err, ok, type Result } from "neverthrow";

import { db } from "@/server/db";
import {
  GameNotFoundError,
  getPublicGameState,
  getPrivateGameState,
} from "@/server/db/common";
import { getBuzzWinner } from "@/server/buzzer/buzzerService";
import { loadChatSummary, type ChatSummary } from "@/server/chat/chatLive";
import { type GameChangeBus, gameChangeBus } from "@/server/live/gameChangeBus";
import { GameFeed } from "@/server/live/gameFeed";
import type { PublicGameState, PrivateGameState, WhoBuzzedIn } from "@/types";

const gameGone = (error: Error) => error instanceof GameNotFoundError;

/**
 * Yields a live feed, turning "the game was deleted" into a clear error
 * that ends the stream instead of leaving the page silently stale.
 */
export async function* endWhenGameDeleted<T>(
  stream: AsyncIterable<T>,
): AsyncGenerator<T, void, undefined> {
  try {
    yield* stream;
  } catch (error) {
    if (error instanceof GameNotFoundError) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This game was deleted by its host.",
      });
    }
    throw error;
  }
}

/** Bus topic for chat changes, separate so chat never reloads game state. */
export const chatTopic = (gameId: string) => `chat:${gameId}`;

/**
 * Chat change signals. Reloads on chat changes and on game changes (names,
 * teams, roles, finishing), coalesces bursts into one read, and re-checks
 * every 5 seconds in case a notification was lost.
 */
export function createChatFeed(bus: () => GameChangeBus) {
  return new GameFeed<ChatSummary>("chat", bus, loadChatSummary, {
    topics: (gameId) => [gameId, chatTopic(gameId)],
    coalesceMs: 100,
    refreshEveryMs: 5_000,
    isTerminal: gameGone,
  });
}

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
    { isTerminal: gameGone },
  ),
  privateGameState: new GameFeed<PrivateGameState>(
    "private game state",
    gameChangeBus,
    (gameId) => getPrivateGameState({ gameId }),
    { isTerminal: gameGone },
  ),
  /** Kept for tabs opened before PR04; current pages use `buzzWinner`. */
  whoBuzzedIn: new GameFeed<WhoBuzzedIn>(
    "who buzzed in",
    gameChangeBus,
    (gameId) => getWhoBuzzedIn(gameId),
  ),
  chat: createChatFeed(gameChangeBus),
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

/**
 * Announces a committed chat change (message, moderation, mute or channel
 * setting). Carries no content; viewers re-fetch what they may see.
 */
export async function emitChatChanged(gameId: Game["id"]): Promise<void> {
  await gameChangeBus().notify(chatTopic(gameId));
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
