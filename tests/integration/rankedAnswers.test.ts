/**
 * Ranked Answers through the real routers: setup, start, play, scores on the
 * shared scoreboard, privacy of hidden answers, races and undo.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sampleContent } from "@/utils/rankedAnswers/sample";

import {
  createGame,
  createUser,
  currentScores,
  db,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

const rid = () => randomUUID().replaceAll("-", "");

async function readyGame(teams = 2) {
  const created = await createGame({ teams });
  const ra = created.admin.rankedAnswers;
  const content = sampleContent(teams);
  if (teams > 2) content.rules.playStyle = "faceOffLadder";
  const { draftRevision } = await ra.saveDraft({
    draft: content,
    expectedRevision: 0,
  });
  return { ...created, ra, content, draftRevision };
}

async function act(
  ra: ReturnType<typeof requestCaller>["rankedAnswers"],
  action: Parameters<
    ReturnType<typeof requestCaller>["rankedAnswers"]["act"]
  >[0]["action"],
) {
  const { step } = await ra.hostView();
  return ra.act({ action, expectedStep: step, requestId: rid() });
}

describe("setup", () => {
  it("saves drafts with conflict protection and refuses an invalid start", async () => {
    const { ra, draftRevision, content } = await readyGame();

    await expect(
      ra.saveDraft({ draft: content, expectedRevision: draftRevision - 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const broken = structuredClone(content);
    broken.boards[1]!.answers = broken.boards[1]!.answers.slice(0, 2);
    await ra.saveDraft({ draft: broken, expectedRevision: draftRevision });
    await expect(ra.start()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("needs at least 4 answers") as unknown,
    });
    expect((await ra.hostView()).status).toBe("draft");
  });

  it("refuses a play style that doesn't fit the number of teams", async () => {
    const created = await createGame({ teams: 3 });
    const content = sampleContent(3);
    content.rules.playStyle = "classic";
    await created.admin.rankedAnswers.saveDraft({
      draft: content,
      expectedRevision: 0,
    });
    await expect(created.admin.rankedAnswers.start()).rejects.toMatchObject({
      message: expect.stringContaining("needs 2 teams") as unknown,
    });
  });

  it("is for owners and co-hosts: moderators and players can't see answers", async () => {
    const { game, ra } = await readyGame();
    const user = await createUser("Mod");
    await db.gameAdmin.create({
      data: { userId: user.id, gameId: game.id, role: "moderator" },
    });
    const guest = await joinAsGuest(game.code);

    await expect(
      requestCaller({ gameId: game.id, user }).rankedAnswers.hostView(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(guest.player.rankedAnswers.hostView()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await ra.start();
    await expect(guest.player.rankedAnswers.start()).rejects.toBeDefined();
  });
});

describe("play", () => {
  it("runs a classic board: points land on the scoreboard, hidden answers never leave the server", async () => {
    const { game, ra, gameTeams } = await readyGame(2);
    const [a, b] = [gameTeams[0]!.id, gameTeams[1]!.id];
    const guest = await joinAsGuest(game.code);
    await ra.start();
    await act(ra, { type: "startBoard", boardId: "tree" });

    // Before any reveal, no answer text reaches players or the display.
    for (const state of [
      await guest.player.gameGeneral.currentGameState(),
      await requestCaller({}).public.currentGameState({ gameId: game.id }),
    ]) {
      const json = JSON.stringify(state);
      for (const word of ["Lights", "Ornaments", "Tinsel", "baubles"]) {
        expect(json).not.toContain(word);
      }
      expect(state.mode?.board?.rows.every((r) => r.text === null)).toBe(true);
      expect(state.mode?.board?.prompt).toBe(
        "Things people hang on a holiday tree",
      );
    }

    await act(ra, {
      type: "faceOff",
      answers: [
        { team: a, answerId: "a2" },
        { team: b, answerId: "a4" },
      ],
    });
    await act(ra, { type: "playOrPass", play: true });
    await act(ra, { type: "answer", answerId: "a1" });
    await act(ra, { type: "answer", answerId: null });
    await act(ra, { type: "answer", answerId: null });
    await act(ra, { type: "answer", answerId: null });
    // Steal with "Tinsel" (14): bank was Ornaments 27 + Star 10 + Lights 35.
    await act(ra, { type: "steal", answers: { [b]: "a3" } });

    expect(await currentScores(game.id)).toMatchObject({
      [a]: 0,
      [b]: 27 + 10 + 35 + 14,
    });
    const shown = (await guest.player.gameGeneral.currentGameState()).mode!
      .board!;
    expect(shown.phase).toBe("closed");
    expect(shown.rows.filter((r) => r.text).map((r) => r.text)).toEqual([
      "Lights",
      "Ornaments",
      "Tinsel",
      "Star",
    ]);
    expect(JSON.stringify(shown)).not.toContain("Candy canes");

    await act(ra, { type: "revealRemaining" });
    const after = await requestCaller({}).public.currentGameState({
      gameId: game.id,
    });
    expect(after.mode!.board!.rows.every((r) => r.text !== null)).toBe(true);
    expect(await currentScores(game.id)).toMatchObject({ [b]: 86 });
  });

  it("practice boards score nothing; a double-points board doubles", async () => {
    const { game, ra, gameTeams } = await readyGame(2);
    const [a] = [gameTeams[0]!.id];
    await ra.start();
    await act(ra, { type: "startBoard", boardId: "practice" });
    await act(ra, {
      type: "faceOff",
      answers: [{ team: a, answerId: "a1" }],
    });
    await act(ra, { type: "closeBoard" });
    expect(await currentScores(game.id)).toMatchObject({ [a]: 0 });

    await act(ra, { type: "startBoard", boardId: "regift" });
    await act(ra, {
      type: "faceOff",
      answers: [{ team: a, answerId: "a1" }],
    });
    await act(ra, { type: "closeBoard" });
    // Candles 29 × 2, banked and given to the face-off winner on close.
    expect(await currentScores(game.id)).toMatchObject({ [a]: 58 });
  });

  it("applies each action once: a retry is a no-op and a stale screen is refused", async () => {
    const { game, ra, gameTeams } = await readyGame(2);
    const a = gameTeams[0]!.id;
    await ra.start();
    await act(ra, { type: "startBoard", boardId: "tree" });
    await act(ra, { type: "faceOff", answers: [{ team: a, answerId: "a1" }] });
    await act(ra, { type: "playOrPass", play: true });
    const { step } = await ra.hostView();
    const requestId = rid();
    const action = { type: "answer" as const, answerId: "a2" };

    const results = await Promise.allSettled([
      ra.act({ action, expectedStep: step, requestId }),
      ra.act({ action, expectedStep: step, requestId }),
      ra.act({ action, expectedStep: step, requestId: rid() }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason).toMatchObject({ code: "CONFLICT" });
      }
    }
    const view = await ra.hostView();
    expect(view.step).toBe(step + 1);
    // Bank: Lights 35 + Ornaments 27, nothing counted twice.
    expect(view.state!.board!.bank).toBe(62);
    expect(await currentScores(game.id)).toMatchObject({ [a]: 0 });
  });

  it("undo takes back the points and keeps a shown answer shown, for 0", async () => {
    const created = await createGame({ teams: 2 });
    const content = sampleContent(2);
    content.rules.playStyle = "roundRobin";
    await created.admin.rankedAnswers.saveDraft({
      draft: content,
      expectedRevision: 0,
    });
    const ra = created.admin.rankedAnswers;
    const [a] = [created.gameTeams[0]!.id];
    await ra.start();
    await act(ra, { type: "startBoard", boardId: "dinner" });
    await act(ra, { type: "answer", answerId: "a1" });
    expect(await currentScores(created.game.id)).toMatchObject({ [a]: 38 });

    const { step } = await ra.hostView();
    await ra.undo({ expectedStep: step, requestId: rid() });

    expect(await currentScores(created.game.id)).toMatchObject({ [a]: 0 });
    const row = (
      await requestCaller({}).public.currentGameState({
        gameId: created.game.id,
      })
    ).mode!.board!.rows[0]!;
    expect(row).toMatchObject({ text: "Turkey", leftover: true });
    // Nobody can score Turkey now.
    await act(ra, { type: "answer", answerId: "a1" });
    expect(await currentScores(created.game.id)).toMatchObject({ [a]: 0 });
  });

  it("face-off ladder: every other team steals at once, best steal takes the bank", async () => {
    const { game, ra, gameTeams } = await readyGame(4);
    const [t1, t2, t3, t4] = gameTeams.map((t) => t.id) as [
      string,
      string,
      string,
      string,
    ];
    await ra.start();
    await act(ra, { type: "startBoard", boardId: "dinner" });
    expect((await ra.hostView()).state!.board!.faceOffTeams).toEqual([t1, t2]);
    await act(ra, { type: "faceOff", answers: [{ team: t1, answerId: "a6" }] });
    await act(ra, { type: "playOrPass", play: true });
    for (let i = 0; i < 3; i++)
      await act(ra, { type: "answer", answerId: null });
    await act(ra, {
      type: "steal",
      answers: { [t2]: "a3", [t3]: "a1", [t4]: null },
    });

    // Bank = Rolls 4; T3's Turkey (38) is best: bank + 38. T2 keeps Stuffing 14.
    expect(await currentScores(game.id)).toMatchObject({
      [t1]: 0,
      [t2]: 14,
      [t3]: 42,
      [t4]: 0,
    });
  });

  it("use basic controls: the board leaves the screens, scores stay", async () => {
    const { game, ra, gameTeams } = await readyGame(2);
    await ra.start();
    await act(ra, { type: "startBoard", boardId: "tree" });
    await act(ra, {
      type: "faceOff",
      answers: [{ team: gameTeams[0]!.id, answerId: "a1" }],
    });
    await act(ra, { type: "closeBoard" });
    await ra.end();

    const state = await requestCaller({}).public.currentGameState({
      gameId: game.id,
    });
    expect(state.mode?.status).toBe("ended");
    expect(await currentScores(game.id)).toMatchObject({
      [gameTeams[0]!.id]: 35,
    });
    await expect(
      act(ra, { type: "startBoard", boardId: "dinner" }),
    ).rejects.toMatchObject({ message: "The game mode isn't running." });
    await expect(
      ra.saveDraft({ draft: sampleContent(2), expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
