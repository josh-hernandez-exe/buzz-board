/**
 * Applies data retention. Safe to run repeatedly; schedule it (for example
 * hourly) with the production environment:
 *
 *   bun --env-file=.env.production run ops:cleanup
 *
 * - Chat message bodies older than the retention period are removed. Reads
 *   already hide them if this runs late.
 * - Expired chat mutes are deleted.
 * - Moderation reasons older than 30 days are stripped from the audit log.
 * - Unfinished games with no activity for 7 days (no buzzes, answers, chat,
 *   score or mode actions, or roster changes) are reported, never deleted:
 *   the operator decides whether to contact the host or close them.
 * - `overdueBodies` counts chat text that should already have been removed
 *   (over 2 hours late) before this run. Non-zero means earlier scheduled
 *   runs failed or were missed: alert on it.
 *
 * Prints a JSON summary and exits non-zero on failure so a scheduler can
 * alert on it.
 */
import { cleanupChat } from "@/server/chat/chatService";
import { CHAT_LIMITS } from "@/utils/chatLimits";
import { db } from "@/server/db";

import { findStaleUnfinishedGames } from "./staleGames";

try {
  const overdueBodies = await db.chatMessage.count({
    where: {
      body: { not: null },
      createdAt: {
        lt: new Date(
          Date.now() - CHAT_LIMITS.retentionDays * 86_400_000 - 2 * 3_600_000,
        ),
      },
    },
  });
  const summary = await cleanupChat();
  const staleUnfinishedGames = await findStaleUnfinishedGames();
  console.log(
    JSON.stringify({
      ok: true,
      at: new Date().toISOString(),
      overdueBodies,
      ...summary,
      staleUnfinishedGames,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error) }));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
