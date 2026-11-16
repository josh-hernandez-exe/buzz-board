/**
 * The ops:cleanup stale-game report. Buzzes, answers, chat, score commands,
 * mode actions and roster changes write their own tables without touching the
 * Game row, so a game busy with any of them this week must not be reported.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { GameStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { findStaleUnfinishedGames } from "../../scripts/ops/staleGames";
import { createUser, db } from "../support/integration";

// Older than anything else in the shared test database, so these games sort
// first in the report's oldest-first, capped list.
const LONG_AGO = new Date("2000-01-01T00:00:00Z");

type Fixture = { gameId: string; teamId: string; playerId: string };

/** A game with one team and one player, none touched since LONG_AGO. */
async function idleGame(status: GameStatus = GameStatus.running) {
  const host = await createUser();
  const game = await db.game.create({
    data: {
      name: "Idle game",
      code: randomBytes(3).toString("hex").toUpperCase(),
      createdById: host.id,
      status,
    },
  });
  const team = await db.gameTeam.create({
    data: { gameId: game.id, index: 0, name: "Team 1" },
  });
  const player = await db.gameUser.create({
    data: {
      gameId: game.id,
      gameTeamId: team.id,
      name: "Player 1",
      index: 0,
      token: randomUUID(),
    },
  });
  await db.$executeRaw`UPDATE "GameUser" SET "updatedAt" = ${LONG_AGO} WHERE "gameId" = ${game.id}`;
  await db.$executeRaw`UPDATE "Game" SET "updatedAt" = ${LONG_AGO} WHERE id = ${game.id}`;
  return { gameId: game.id, teamId: team.id, playerId: player.id };
}

const staleIds = async () =>
  (await findStaleUnfinishedGames()).map((game) => game.id);

const activity: Record<string, (fixture: Fixture) => Promise<unknown>> = {
  "a score command or mode action": ({ gameId }) =>
    db.gameOperation.create({
      data: {
        gameId,
        requestId: randomUUID(),
        action: "score.adjust",
        payloadHash: "hash",
      },
    }),
  "a buzz": ({ gameId, teamId, playerId }) =>
    db.buzzClaim.create({
      data: { gameId, window: 1, gameTeamId: teamId, gameUserId: playerId },
    }),
  "a queued buzz": ({ gameId, teamId, playerId }) =>
    db.buzzQueueEntry.create({
      data: {
        gameId,
        window: 1,
        position: 1,
        gameTeamId: teamId,
        gameUserId: playerId,
        status: "waiting",
      },
    }),
  "a saved answer": ({ gameId, teamId, playerId }) =>
    db.teamAnswer.create({
      data: {
        gameId,
        questionKey: "0:q1",
        gameTeamId: teamId,
        text: "Answer",
        savedById: playerId,
      },
    }),
  "a chat message": async ({ gameId, playerId }) => {
    const channel = await db.chatChannel.create({
      data: { gameId, key: "everyone" },
    });
    return db.chatMessage.create({
      data: {
        gameId,
        channelId: channel.id,
        sequence: 1,
        actorKey: `player:${playerId}`,
        requestId: randomUUID(),
        bodyHash: "hash",
        body: "Hello",
      },
    });
  },
  "a roster change": ({ playerId }) =>
    db.gameUser.update({
      where: { id: playerId },
      data: { name: "Renamed" },
    }),
  "a mode edit": ({ gameId }) =>
    db.gameMode.create({
      data: { gameId, kind: "sequentialQuiz", draft: {} },
    }),
  "a buzzer open or reset": ({ gameId }) =>
    db.buzzerHistory.create({ data: { gameId } }),
};

describe("stale unfinished games report", () => {
  it("lists an unfinished game idle for a week, never a finished one", async () => {
    const idle = await idleGame();
    const finished = await idleGame(GameStatus.finished);

    const ids = await staleIds();

    expect(ids).toContain(idle.gameId);
    expect(ids).not.toContain(finished.gameId);
  });

  it.each(Object.entries(activity))(
    "leaves out a game with %s this week",
    async (_label, act) => {
      const busy = await idleGame();
      await act(busy);

      expect(await staleIds()).not.toContain(busy.gameId);
    },
  );
});
