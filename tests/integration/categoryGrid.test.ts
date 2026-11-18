/**
 * Category Grid through the real routers: set up at creation, start, play,
 * scores on the shared scoreboard, privacy of clues and answers, retries,
 * stale screens, undo and void.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PublicGameModeView } from "@/utils/modes";
import { sampleBank } from "@/utils/categoryGrid/sample";

import {
  callerFor,
  createGame,
  createUser,
  currentScores,
  db,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

const rid = () => randomUUID().replaceAll("-", "");

function grid(mode: PublicGameModeView | null) {
  if (mode?.kind !== "categoryGrid") throw new Error("not a Category Grid");
  return mode;
}

async function readyGrid(teams = 2) {
  const created = await createGame({ teams });
  const cg = created.admin.categoryGrid;
  await cg.saveDraft({ draft: sampleBank(), expectedRevision: 0 });
  await cg.start();
  return { ...created, cg };
}

async function act(
  cg: ReturnType<typeof requestCaller>["categoryGrid"],
  action: Parameters<
    ReturnType<typeof requestCaller>["categoryGrid"]["act"]
  >[0]["action"],
) {
  const { step } = await cg.hostView();
  return cg.act({ action, expectedStep: step, requestId: rid() });
}

describe("setup", () => {
  it("is chosen at creation with sample clues, and copied by duplicate", async () => {
    const host = await createUser();
    const user = await callerFor({ user: host });
    const game = await user.user.game.create({
      name: "Grid night",
      format: "team",
      teamCount: 3,
      categoryGrid: {
        rules: { wrongAnswerPenalty: "clueValue" },
        sampleGrid: true,
      },
    });
    const admin = requestCaller({ gameId: game.id, user: host });
    const view = await admin.categoryGrid.hostView();
    expect(view.status).toBe("draft");
    expect(view.preflight.blocking).toEqual([]);
    expect(view.draft.modes.categoryGrid?.rules).toEqual({
      wrongAnswerPenalty: "clueValue",
    });
    // The Ranked Answers tab knows the game uses a grid.
    expect((await admin.rankedAnswers.hostView()).otherMode).toBe(
      "categoryGrid",
    );
    await expect(
      admin.rankedAnswers.saveDraft({
        draft: { rules: {}, boards: [] },
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const copy = await admin.gameAdmin.duplicateGame({ requestId: rid() });
    const copied = await requestCaller({
      gameId: copy.gameId,
      user: host,
    }).categoryGrid.hostView();
    expect(copied.draft).toEqual(view.draft);
  });

  it("refuses an unfinished grid, and is for owners and co-hosts only", async () => {
    const created = await createGame({ teams: 2 });
    const cg = created.admin.categoryGrid;
    const empty = (await cg.hostView()).draft;
    await cg.saveDraft({ draft: empty, expectedRevision: 0 });
    await expect(cg.start()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    const mod = await createUser("Mod");
    await db.gameAdmin.create({
      data: { userId: mod.id, gameId: created.game.id, role: "moderator" },
    });
    const guest = await joinAsGuest(created.game.code);
    await expect(
      requestCaller({
        gameId: created.game.id,
        user: mod,
      }).categoryGrid.hostView(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(guest.player.categoryGrid.hostView()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("can't be set up while the game uses Ranked Answers", async () => {
    const created = await createGame({ teams: 2 });
    await created.admin.rankedAnswers.saveDraft({
      draft: {
        rules: (await created.admin.rankedAnswers.hostView()).draft.rules,
        boards: [],
      },
      expectedRevision: 0,
    });
    await expect(
      created.admin.categoryGrid.saveDraft({
        draft: sampleBank(),
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("set up for Ranked Answers") as unknown,
    });
  });
});

describe("play", () => {
  it("keeps clues and answers private until shown, and scores right answers", async () => {
    const { game, cg, gameTeams } = await readyGrid();
    const [a, b] = gameTeams.map((t) => t.id);
    const guest = await joinAsGuest(game.code);
    const states = async () => [
      await guest.player.gameGeneral.currentGameState(),
      await requestCaller({}).public.currentGameState({ gameId: game.id }),
    ];
    for (const state of await states()) {
      const json = JSON.stringify(state);
      expect(json).not.toContain("snowflake");
      expect(json).not.toContain("Sublimation");
      expect(grid(state.mode).columns[0]!.title).toBe("Winter Science");
    }

    await act(cg, { type: "openClue", cell: "cat1:4" });
    for (const state of await states()) {
      const view = grid(state.mode);
      expect(view.clue?.prompt).toContain("snow turns straight into water");
      expect(view.clue?.answer).toBeNull();
      expect(JSON.stringify(state)).not.toContain("Sublimation");
    }

    await act(cg, { type: "judge", team: a!, correct: false });
    await act(cg, { type: "judge", team: b!, correct: true });
    for (const state of await states()) {
      expect(grid(state.mode).clue?.answer).toBe("Sublimation");
    }
    expect(await currentScores(game.id)).toMatchObject({ [a!]: 0, [b!]: 500 });
    await act(cg, { type: "closeClue" });
    const view = grid((await states())[0]!.mode);
    expect(view.selector).toBe(b);
    expect(view.columns[0]!.tiles[4]).toMatchObject({
      state: "correct",
      team: b,
    });
  });

  it("applies each action once, refuses a stale screen, and undo takes points back", async () => {
    const { game, cg, gameTeams } = await readyGrid();
    const [a] = gameTeams.map((t) => t.id);
    await act(cg, { type: "openClue", cell: "cat2:1" });
    const { step } = await cg.hostView();
    const request = {
      action: { type: "judge" as const, team: a!, correct: true },
      expectedStep: step,
      requestId: rid(),
    };
    await cg.act(request);
    await expect(cg.act(request)).resolves.toMatchObject({ replayed: true });
    await expect(
      cg.act({ ...request, requestId: rid() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await currentScores(game.id))[a!]).toBe(200);

    const now = await cg.hostView();
    await cg.undo({ expectedStep: now.step, requestId: rid() });
    expect((await currentScores(game.id))[a!]).toBe(0);
    // The answer was on screen, so it stays shown while the host re-judges.
    expect((await cg.hostView()).view?.clue?.answer).toBe("A candy cane");
  });

  it("void takes back only this clue's points; a deleted team never blocks play", async () => {
    const created = await createGame({ teams: 3 });
    const cg = created.admin.categoryGrid;
    const bank = sampleBank();
    bank.modes.categoryGrid!.rules = { wrongAnswerPenalty: "clueValue" };
    await cg.saveDraft({ draft: bank, expectedRevision: 0 });
    await cg.start();
    const [a, b, c] = created.gameTeams.map((t) => t.id);

    await act(cg, { type: "openClue", cell: "cat3:0" });
    await act(cg, { type: "judge", team: c!, correct: true });
    await act(cg, { type: "closeClue" });
    await act(cg, { type: "openClue", cell: "cat5:3" });
    await act(cg, { type: "judge", team: a!, correct: false });
    await act(cg, { type: "judge", team: b!, correct: true });
    expect(await currentScores(created.game.id)).toMatchObject({
      [a!]: -400,
      [b!]: 400,
      [c!]: 100,
    });
    await act(cg, { type: "voidClue" });
    expect(await currentScores(created.game.id)).toMatchObject({
      [a!]: 0,
      [b!]: 0,
      [c!]: 100,
    });

    // Delete team C (who scored), then undo past its points: nothing jams.
    await created.admin.gameAdmin.removeTeam({ gameTeamId: c! });
    for (let i = 0; i < 4; i++) {
      const { step } = await cg.hostView();
      await cg.undo({ expectedStep: step, requestId: rid() });
    }
    expect((await cg.hostView()).state?.clue).toBeNull();
    await act(cg, { type: "openClue", cell: "cat1:1" });
    await act(cg, { type: "judge", team: a!, correct: true });
    expect((await currentScores(created.game.id))[a!]).toBe(200);
  });
});
