import { GameStatus } from "@prisma/client";

import { db } from "@/server/db";

export const STALE_GAME_DAYS = 7;

/**
 * Unfinished games with no activity for `days` (oldest first, at most 100).
 * Buzzes, answers, chat, score commands, mode actions and roster changes
 * write their own tables without touching the Game row, so every one of
 * those must be quiet too, not just `Game.updatedAt`.
 */
export function findStaleUnfinishedGames({
  now = new Date(),
  days = STALE_GAME_DAYS,
}: { now?: Date; days?: number } = {}) {
  const staleBefore = new Date(now.getTime() - days * 86_400_000);
  const recent = { gte: staleBefore };
  return db.game.findMany({
    where: {
      status: { not: GameStatus.finished },
      updatedAt: { lt: staleBefore },
      operations: { none: { createdAt: recent } },
      buzzClaims: { none: { createdAt: recent } },
      buzzQueue: { none: { updatedAt: recent } },
      teamAnswers: { none: { updatedAt: recent } },
      chatMessages: { none: { createdAt: recent } },
      gameUsers: { none: { updatedAt: recent } },
      gameMode: { isNot: { updatedAt: recent } },
      buzzerHistory: { isNot: { updatedAt: recent } },
    },
    select: { id: true, code: true, status: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });
}
