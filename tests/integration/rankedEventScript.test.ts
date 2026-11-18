/**
 * The event's own rehearsal script (search-prediction trivia, 2026 event
 * plan), through the real routers and scoreboard:
 * - four teams A-D in a fixed order, one answer per turn, no bonus turn;
 * - points are 11 - rank (rank 1 = 10 ... rank 9 = 2);
 * - misses, repeats, passes and timeouts score 0 with no penalty;
 * - up to three cycles; a full cycle with no new answer closes the board;
 * - remaining answers are revealed for 0 points; the next board's starter
 *   moves one team along (A, then B, ...);
 * - no buzzer, strikes or steals.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PublicGameModeView } from "@/utils/modes";
import { contentSchema, type Content } from "@/utils/rankedAnswers/content";

import {
  createGame,
  currentScores,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

const rid = () => randomUUID().replaceAll("-", "");

/** M39 with its first nine captured answers (rehearsal fixture only). */
const M39 = [
  "TikTok",
  "Instagram",
  "Discord",
  "Snapchat",
  "Teams",
  "Facebook",
  "Slack",
  "LinkedIn",
  "Zoom",
];

const board = (
  id: string,
  prompt: string,
  answers: string[],
  role = "main",
) => ({
  id,
  role,
  prompt,
  answers: answers.map((text, i) => ({
    id: text.toLowerCase(),
    text,
    aliases: i === 0 ? ["tik tok"] : [],
  })),
});

function eventContent(): Content {
  return contentSchema.parse({
    rules: {
      playStyle: "roundRobin",
      // 11 - rank.
      pointValuesByRank: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      multiplier: 1,
      strikes: 3,
      turnCycles: 3,
      allPlayRounds: 1,
      faceOffMethod: "none",
      endOnEmptyCycle: true,
    },
    boards: [
      board(
        "practice",
        "best holiday snack",
        ["Cookies", "Fudge", "Popcorn", "Candy canes"],
        "practice",
      ),
      board("m39", "how to set pronouns on ", M39),
      board("words", "gender neutral word for ", [
        "aunt or uncle",
        "sportsmanship",
        "chairman",
        "mankind",
        "fireman",
      ]),
      board("books", "sapphic retelling of ", [
        "Swan Lake",
        "Carmilla",
        "Pride and Prejudice",
        "Little Women",
      ]),
    ],
  });
}

function ranked(mode: PublicGameModeView | null) {
  if (mode?.kind !== "rankedAnswers") throw new Error("not Ranked Answers");
  return mode;
}

async function eventGame() {
  const created = await createGame({ teams: 4 });
  const ra = created.admin.rankedAnswers;
  await ra.saveDraft({ draft: eventContent(), expectedRevision: 0 });
  const view = await ra.hostView();
  expect(view.preflight.blocking).toEqual([]);
  await ra.start();
  const [A, B, C, D] = created.gameTeams.map((t) => t.id) as [
    string,
    string,
    string,
    string,
  ];
  type Act = Parameters<typeof ra.act>[0]["action"];
  const act = async (action: Act) => {
    const { step } = await ra.hostView();
    return ra.act({ action, expectedStep: step, requestId: rid() });
  };
  const turnTeam = async () => {
    const b = (await ra.hostView()).state!.board!;
    return b.phase === "turns" ? b.order[b.turn % b.order.length] : null;
  };
  const scores = async () => {
    const s = await currentScores(created.game.id);
    return { A: s[A] ?? 0, B: s[B] ?? 0, C: s[C] ?? 0, D: s[D] ?? 0 };
  };
  const revealedRanks = async () =>
    (await ra.hostView())
      .state!.board!.revealed.filter((r) => !r.leftover)
      .map((r) => r.rank)
      .sort((x, y) => x - y);
  return { ...created, ra, act, turnTeam, scores, revealedRanks, A, B, C, D };
}

describe("event rehearsal script (round robin, 11 - rank)", () => {
  it("plays M39 turn by turn exactly as the script expects", async () => {
    const g = await eventGame();
    // A practice board first: plays normally, scores nothing, and doesn't
    // move the starter.
    await g.act({ type: "startBoard", boardId: "practice" });
    await g.act({ type: "answer", answerId: "cookies" });
    await g.act({ type: "closeBoard" });
    expect(await g.scores()).toEqual({ A: 0, B: 0, C: 0, D: 0 });

    await g.act({ type: "startBoard", boardId: "m39" });
    const script: [string, string | null][] = [
      [g.A, "tiktok"], // rank 1: A +10
      [g.B, "tiktok"], // already shown: a miss
      [g.C, null], // Spotify: not on the board
      [g.D, null], // pass
      [g.A, "instagram"], // rank 2: A +9
      [g.B, "zoom"], // rank 9: B +2
      [g.C, null], // timeout
      [g.D, "teams"], // rank 5: D +6
    ];
    for (const [team, answerId] of script) {
      expect(await g.turnTeam()).toBe(team);
      await g.act({ type: "answer", answerId });
    }
    expect(await g.scores()).toEqual({ A: 19, B: 2, C: 0, D: 6 });
    expect(await g.revealedRanks()).toEqual([1, 2, 5, 9]);
    // The board stays open after rank 1 is found; A is up again.
    expect(await g.turnTeam()).toBe(g.A);
  });

  it("a full cycle with no new answer closes a fresh board", async () => {
    const g = await eventGame();
    await g.act({ type: "startBoard", boardId: "m39" });
    for (let i = 0; i < 3; i++) await g.act({ type: "answer", answerId: null });
    expect((await g.ra.hostView()).state!.board!.phase).toBe("turns");
    await g.act({ type: "answer", answerId: null });
    expect((await g.ra.hostView()).state!.board!.phase).toBe("closed");
    const shown = ranked(
      (await requestCaller({}).public.currentGameState({ gameId: g.game.id }))
        .mode,
    );
    expect(shown.board?.endedBy).toBe("emptyCycle");
  });

  it("a find anywhere in a cycle keeps the board open; the next empty cycle closes it", async () => {
    const g = await eventGame();
    await g.act({ type: "startBoard", boardId: "m39" });
    // Cycle 1: only D finds something.
    for (const id of [null, null, null, "zoom"]) {
      await g.act({ type: "answer", answerId: id });
    }
    // Cycle 2: nothing new (a repeat counts as nothing).
    for (const id of ["zoom", null, null]) {
      await g.act({ type: "answer", answerId: id });
    }
    expect((await g.ra.hostView()).state!.board!.phase).toBe("turns");
    await g.act({ type: "answer", answerId: null });
    expect((await g.ra.hostView()).state!.board!.phase).toBe("closed");
    expect(await g.scores()).toEqual({ A: 0, B: 0, C: 0, D: 2 });
  });

  it("stops after three cycles (12 attempts) even while answers keep coming", async () => {
    const g = await eventGame();
    await g.act({ type: "startBoard", boardId: "m39" });
    const ids = M39.map((t) => t.toLowerCase());
    // One find per cycle keeps it open; 12 attempts in all.
    for (let turn = 0; turn < 12; turn++) {
      await g.act({
        type: "answer",
        answerId: turn % 4 === 0 ? ids[turn / 4]! : null,
      });
    }
    const b = (await g.ra.hostView()).state!.board!;
    expect(b.phase).toBe("closed");
    expect(b.turn).toBe(12);
    expect(b.endedBy).toBe("outOfTurns");
  });

  it("a double-clicked award scores once and advances one turn", async () => {
    const g = await eventGame();
    await g.act({ type: "startBoard", boardId: "m39" });
    const { step } = await g.ra.hostView();
    const click = {
      action: { type: "answer" as const, answerId: "tiktok" },
      expectedStep: step,
    };
    // The same click sent twice (a retry) and a second click from a screen
    // that hadn't refreshed (same step, new request).
    const requestId = rid();
    await g.ra.act({ ...click, requestId });
    await g.ra.act({ ...click, requestId });
    await expect(
      g.ra.act({ ...click, requestId: rid() }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await g.scores()).toEqual({ A: 10, B: 0, C: 0, D: 0 });
    expect(await g.turnTeam()).toBe(g.B);
  });

  it("closing and revealing doesn't change scores, and late answers can't score", async () => {
    const g = await eventGame();
    await g.act({ type: "startBoard", boardId: "m39" });
    await g.act({ type: "answer", answerId: "tiktok" });
    await g.act({ type: "closeBoard" });
    await g.act({ type: "revealRemaining" });
    expect(await g.scores()).toEqual({ A: 10, B: 0, C: 0, D: 0 });
    const b = (await g.ra.hostView()).state!.board!;
    expect(b.revealed).toHaveLength(9);
    expect(
      b.revealed.filter((r) => r.leftover).every((r) => r.points === 0),
    ).toBe(true);
    await expect(
      g.act({ type: "answer", answerId: "zoom" }),
    ).rejects.toBeDefined();
    expect(await g.scores()).toEqual({ A: 10, B: 0, C: 0, D: 0 });
  });

  it("scores carry over and B starts the next board, then C", async () => {
    const g = await eventGame();
    await g.act({ type: "startBoard", boardId: "m39" });
    await g.act({ type: "answer", answerId: "tiktok" });
    await g.act({ type: "closeBoard" });
    await g.act({ type: "startBoard", boardId: "words" });
    expect(await g.turnTeam()).toBe(g.B);
    await g.act({ type: "answer", answerId: "chairman" }); // rank 3: B +8
    expect(await g.scores()).toEqual({ A: 10, B: 8, C: 0, D: 0 });
    await g.act({ type: "closeBoard" });
    await g.act({ type: "startBoard", boardId: "books" });
    expect(await g.turnTeam()).toBe(g.C);
  });

  it("corrections: undo takes the points back but the answer stays shown; an older award is fixed on the scoreboard", async () => {
    const g = await eventGame();
    await g.act({ type: "startBoard", boardId: "m39" });
    await g.act({ type: "answer", answerId: "tiktok" }); // A +10
    await g.act({ type: "answer", answerId: "instagram" }); // B +9, judged by mistake
    // Undo the last award: points go, B is up again, Instagram stays seen.
    const { step } = await g.ra.hostView();
    await g.ra.undo({ expectedStep: step, requestId: rid() });
    expect(await g.scores()).toEqual({ A: 10, B: 0, C: 0, D: 0 });
    expect(await g.turnTeam()).toBe(g.B);
    const row = (await g.ra.hostView()).state!.board!.revealed.find(
      (r) => r.rank === 2,
    );
    expect(row).toMatchObject({ leftover: true, points: 0 });
    // B can't score the row everyone has now seen: it counts as a miss.
    await g.act({ type: "answer", answerId: "instagram" });
    expect(await g.scores()).toEqual({ A: 10, B: 0, C: 0, D: 0 });

    // An award several turns back: adjust that team's score directly.
    await g.admin.gameAdmin.addScore({
      requestId: rid(),
      changes: { [g.A]: -10 },
    });
    expect(await g.scores()).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    // Play carries on from where it was.
    expect(await g.turnTeam()).toBe(g.C);
  });

  it("players and the display never get hidden answers; reconnecting changes nothing", async () => {
    const g = await eventGame();
    const guest = await joinAsGuest(g.game.code);
    await g.act({ type: "startBoard", boardId: "m39" });
    await g.act({ type: "answer", answerId: "tiktok" });
    const before = await g.scores();
    for (const state of [
      await guest.player.gameGeneral.currentGameState(),
      await requestCaller({}).public.currentGameState({ gameId: g.game.id }),
    ]) {
      const json = JSON.stringify(state);
      expect(json).toContain('"TikTok"');
      // Whole JSON strings, so "Teams" doesn't match "gameTeams".
      for (const hidden of M39.slice(1)) {
        expect(json).not.toContain(`"${hidden}"`);
      }
      expect(json).not.toContain('"tik tok"');
      const mode = ranked(state.mode);
      expect(mode.board?.rows.filter((r) => r.text !== null)).toHaveLength(1);
    }
    // A reconnect is just another read: nothing is replayed.
    await guest.player.gameGeneral.currentGameState();
    expect(await g.scores()).toEqual(before);
    expect(await g.turnTeam()).toBe(g.B);
  });
});
