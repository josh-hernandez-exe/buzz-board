/**
 * Sequential Quiz through the real routers: set up at creation, typed team
 * answers (privacy, conflicts, locking), marking by two hosts, reveal and
 * points, undo, a deleted team, and handing back to basic controls.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PublicGameModeView } from "@/utils/modes";
import { sampleQuizBank } from "@/utils/sequentialQuiz/sample";

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
type Quiz = ReturnType<typeof requestCaller>["sequentialQuiz"];
type Action = Parameters<Quiz["act"]>[0]["action"];

function quizView(mode: PublicGameModeView | null) {
  if (mode?.kind !== "sequentialQuiz") throw new Error("not a quiz");
  return mode;
}

type Grade = Extract<Action, { type: "grade" }>;
/** A grade may leave out `key`: it's filled with the current question. */
type LooseAction =
  | Exclude<Action, Grade>
  | (Omit<Grade, "key"> & { key?: string });

async function currentKey(sq: Quiz) {
  return (await sq.hostView()).view?.question?.key ?? "";
}

async function act(sq: Quiz, action: LooseAction) {
  const view = await sq.hostView();
  const full: Action =
    action.type === "grade"
      ? { ...action, key: action.key ?? view.view?.question?.key ?? "" }
      : action;
  return sq.act({ action: full, expectedStep: view.step, requestId: rid() });
}

/** Saves an answer to the question the player's screen shows. */
async function submit(
  p: { player: ReturnType<typeof requestCaller> },
  input: { text: string; baseRevision: number },
) {
  const { questionKey } = await p.player.sequentialQuiz.myAnswer();
  return p.player.sequentialQuiz.submitAnswer({
    ...input,
    questionKey: questionKey ?? "none",
  });
}

/** A started sample quiz with auto team assignment and players on teams. */
async function readyQuiz({ teams = 2, points = 10 } = {}) {
  const created = await createGame({ teams, teamAssignment: "auto" });
  const sq = created.admin.sequentialQuiz;
  const bank = sampleQuizBank();
  bank.modes.pubQuiz!.pointsPerQuestion = points;
  await sq.saveDraft({ draft: bank, expectedRevision: 0 });
  await sq.start();
  const players = [];
  for (const name of ["Ada", "Bea", "Cy", "Di"].slice(0, teams * 2)) {
    const joined = await joinAsGuest(created.game.code, name);
    const row = await db.gameUser.findFirstOrThrow({
      where: { gameId: created.game.id, name },
      select: { gameTeamId: true },
    });
    players.push({ ...joined, team: row.gameTeamId! });
  }
  return { ...created, sq, players };
}

describe("setup", () => {
  it("is chosen at creation with sample questions, and copied by duplicate", async () => {
    const host = await createUser();
    const user = await callerFor({ user: host });
    const game = await user.user.game.create({
      name: "Quiz night",
      format: "team",
      teamCount: 3,
      sequentialQuiz: { pointsPerQuestion: 5, sampleQuiz: true },
    });
    const admin = requestCaller({ gameId: game.id, user: host });
    const view = await admin.sequentialQuiz.hostView();
    expect(view.status).toBe("draft");
    expect(view.preflight.blocking).toEqual([]);
    expect(view.draft.modes.pubQuiz?.pointsPerQuestion).toBe(5);
    expect((await admin.categoryGrid.hostView()).otherMode).toBe(
      "sequentialQuiz",
    );
    await expect(
      admin.categoryGrid.saveDraft({
        draft: view.draft,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Sequential Quiz") as unknown,
    });

    const copy = await admin.gameAdmin.duplicateGame({ requestId: rid() });
    const copied = await requestCaller({
      gameId: copy.gameId,
      user: host,
    }).sequentialQuiz.hostView();
    expect(copied.draft).toEqual(view.draft);
  });

  it("keeps answers and controls to owners and co-hosts", async () => {
    const { game, sq, players } = await readyQuiz();
    await act(sq, { type: "next" });
    const mod = await createUser("Mod");
    await db.gameAdmin.create({
      data: { userId: mod.id, gameId: game.id, role: "moderator" },
    });
    const modQuiz = requestCaller({
      gameId: game.id,
      user: mod,
    }).sequentialQuiz;
    await expect(modQuiz.responses()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(modQuiz.hostView()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const player = players[0]!.player.sequentialQuiz;
    await expect(player.responses()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      player.act({
        action: { type: "lock" },
        expectedStep: 0,
        requestId: rid(),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("answering", () => {
  it("keeps typed answers within the team until and after the reveal", async () => {
    const { game, sq, players } = await readyQuiz();
    const [ada, bea, cy] = players;
    // Auto assignment fills teams evenly: Ada and Cy share a team.
    expect(ada!.team).toBe(cy!.team);
    expect(bea!.team).not.toBe(ada!.team);

    await expect(
      submit(ada!, { text: "x", baseRevision: 0 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await act(sq, { type: "next" });
    const saved = await submit(ada!, {
      text: "  Zebra crossing  ",
      baseRevision: 0,
    });
    expect(saved.revision).toBe(1);

    const publicStates = async () => [
      await bea!.player.gameGeneral.currentGameState(),
      await cy!.player.gameGeneral.currentGameState(),
      await requestCaller({}).public.currentGameState({ gameId: game.id }),
    ];
    for (const state of await publicStates()) {
      expect(JSON.stringify(state)).not.toMatch(/zebra/i);
      expect(quizView(state.mode).answered).toEqual([ada!.team]);
      expect(quizView(state.mode).question?.answer).toBeNull();
    }
    expect(
      JSON.stringify(await bea!.player.sequentialQuiz.myAnswer()),
    ).not.toMatch(/zebra/i);
    expect(await cy!.player.sequentialQuiz.myAnswer()).toMatchObject({
      open: true,
      onTeam: true,
      answer: { text: "Zebra crossing", revision: 1, savedBy: "Ada" },
    });

    // The host sees every team's answer, grouped text ready.
    const { responses } = await sq.responses();
    expect(responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          team: ada!.team,
          text: "Zebra crossing",
          normalized: "zebra crossing",
          savedBy: "Ada",
        }),
        expect.objectContaining({ team: bea!.team, text: null }),
      ]),
    );

    await act(sq, { type: "lock" });
    await act(sq, {
      type: "grade",
      teams: [ada!.team],
      verdict: "incorrect",
      from: { [ada!.team]: null },
    });
    await act(sq, { type: "resolveRemaining" });
    await act(sq, { type: "reveal" });
    for (const state of await publicStates()) {
      expect(JSON.stringify(state)).not.toMatch(/zebra/i);
      expect(quizView(state.mode).question?.answer).toBe("Six");
    }
    expect(await bea!.player.sequentialQuiz.myAnswer()).toMatchObject({
      verdict: "missing",
    });
    expect(await ada!.player.sequentialQuiz.myAnswer()).toMatchObject({
      verdict: "incorrect",
    });
  });

  it("never overwrites a teammate silently, refuses blanks and late saves", async () => {
    const { sq, players } = await readyQuiz();
    const [ada, , cy] = players;
    await act(sq, { type: "next" });
    await submit(ada!, {
      text: "Six",
      baseRevision: 0,
    });
    // Cy started from an empty answer: refused, told what Ada saved.
    await expect(
      submit(cy!, { text: "6", baseRevision: 0 }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(
        'Ada changed your team\'s answer to "Six"',
      ) as unknown,
    });
    // Having seen it, Cy replaces it.
    await expect(
      submit(cy!, { text: "6", baseRevision: 1 }),
    ).resolves.toMatchObject({ revision: 2 });
    expect(await ada!.player.sequentialQuiz.myAnswer()).toMatchObject({
      answer: { text: "6", revision: 2, savedBy: "Cy" },
    });

    await expect(
      submit(ada!, {
        text: "   ",
        baseRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await act(sq, { type: "lock" });
    await expect(
      submit(ada!, {
        text: "Six",
        baseRevision: 2,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("closed") as unknown,
    });
    // Reopening lets the team answer again.
    await act(sq, { type: "reopen" });
    await expect(
      submit(ada!, {
        text: "Six",
        baseRevision: 2,
      }),
    ).resolves.toMatchObject({ revision: 3 });
  });

  it("refuses a player who isn't on a team", async () => {
    const created = await createGame({ teams: 2, teamAssignment: "choose" });
    const sq = created.admin.sequentialQuiz;
    await sq.saveDraft({ draft: sampleQuizBank(), expectedRevision: 0 });
    await sq.start();
    await act(sq, { type: "next" });
    const loner = await joinAsGuest(created.game.code, "Lone");
    expect(await loner.player.sequentialQuiz.myAnswer()).toMatchObject({
      onTeam: false,
      answer: null,
    });
    await expect(
      submit(loner, {
        text: "Six",
        baseRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("works in an individual game: each player answers for themself", async () => {
    const created = await createGame({ format: "individual" });
    const solo = await joinAsGuest(created.game.code, "Solo");
    const other = await joinAsGuest(created.game.code, "Other");
    const sq = created.admin.sequentialQuiz;
    await sq.saveDraft({ draft: sampleQuizBank(), expectedRevision: 0 });
    await sq.start();
    await act(sq, { type: "next" });
    await submit(solo, {
      text: "six",
      baseRevision: 0,
    });
    expect((await other.player.sequentialQuiz.myAnswer()).answer).toBeNull();
    const { responses } = await sq.responses();
    expect(responses.filter((r) => r.text)).toHaveLength(1);
  });
});

describe("marking and scores", () => {
  it("reveals once, undo takes the points back and keeps the answer shown", async () => {
    const { game, sq, players } = await readyQuiz({ points: 10 });
    const [ada, bea] = players;
    await act(sq, { type: "next" });
    await act(sq, { type: "lock" });
    await act(sq, {
      type: "grade",
      teams: [ada!.team, bea!.team],
      verdict: "correct",
      from: { [ada!.team]: null, [bea!.team]: null },
    });
    const { step } = await sq.hostView();
    const reveal = {
      action: { type: "reveal" as const },
      expectedStep: step,
      requestId: rid(),
    };
    await sq.act(reveal);
    await expect(sq.act(reveal)).resolves.toMatchObject({ replayed: true });
    expect(await currentScores(game.id)).toMatchObject({
      [ada!.team]: 10,
      [bea!.team]: 10,
    });

    const now = await sq.hostView();
    await sq.undo({ expectedStep: now.step, requestId: rid() });
    expect(await currentScores(game.id)).toMatchObject({
      [ada!.team]: 0,
      [bea!.team]: 0,
    });
    const after = await sq.hostView();
    expect(after.state?.phase).toBe("locked");
    expect(after.view?.question?.answer).toBe("Six");
    // Answering can't reopen once the answer was seen.
    await expect(act(sq, { type: "reopen" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    await act(sq, {
      type: "grade",
      teams: [bea!.team],
      verdict: "incorrect",
      from: { [bea!.team]: "correct" },
    });
    await act(sq, { type: "reveal" });
    expect(await currentScores(game.id)).toMatchObject({
      [ada!.team]: 10,
      [bea!.team]: 0,
    });
    // The scoreboard's own undo can't reach back into the quiz's points.
    const board = await db.scoreboard.findFirst({ where: { gameId: game.id } });
    expect(board?.pastStateIds ?? []).toEqual([]);
  });

  it("lets two hosts mark at once without silently overwriting", async () => {
    const { game, sq, players } = await readyQuiz();
    const [ada, bea] = players;
    const cohostUser = await createUser("Co");
    await db.gameAdmin.create({
      data: { userId: cohostUser.id, gameId: game.id, role: "admin" },
    });
    const co = requestCaller({
      gameId: game.id,
      user: cohostUser,
    }).sequentialQuiz;
    await act(sq, { type: "next" });
    await act(sq, { type: "lock" });
    // Both screens show Ada's team unmarked, and both mark it: marks don't
    // need the latest step, but the second sees a different verdict now.
    const stale = (await sq.hostView()).step;
    const key = await currentKey(sq);
    await sq.act({
      action: {
        type: "grade",
        key,
        teams: [ada!.team],
        verdict: "correct",
        from: { [ada!.team]: null },
      },
      expectedStep: stale,
      requestId: rid(),
    });
    await expect(
      co.act({
        action: {
          type: "grade",
          key,
          teams: [ada!.team],
          verdict: "incorrect",
          from: { [ada!.team]: null },
        },
        expectedStep: stale,
        requestId: rid(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Marking a different team from the same stale screen is fine.
    await co.act({
      action: {
        type: "grade",
        key,
        teams: [bea!.team],
        verdict: "incorrect",
        from: { [bea!.team]: null },
      },
      expectedStep: stale,
      requestId: rid(),
    });
    expect((await sq.hostView()).state?.grades).toEqual({
      [ada!.team]: "correct",
      [bea!.team]: "incorrect",
    });
    // Other actions still need the latest step.
    await expect(
      sq.act({
        action: { type: "reveal" },
        expectedStep: stale,
        requestId: rid(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a mark or a save meant for a question that has moved on", async () => {
    const { sq, players } = await readyQuiz();
    const [ada] = players;
    await act(sq, { type: "next" });
    const first = await currentKey(sq);
    await act(sq, { type: "lock" });
    await act(sq, { type: "void" });
    await act(sq, { type: "next" });
    // A save still on its way from question 1 isn't stored for question 2.
    await expect(
      ada!.player.sequentialQuiz.submitAnswer({
        questionKey: first,
        text: "Six",
        baseRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await ada!.player.sequentialQuiz.myAnswer()).answer).toBeNull();

    await act(sq, { type: "lock" });
    // A mark from a screen still showing question 1, where the team was
    // unmarked too, doesn't land on question 2.
    const { step } = await sq.hostView();
    await expect(
      sq.act({
        action: {
          type: "grade",
          key: first,
          teams: [ada!.team],
          verdict: "correct",
          from: { [ada!.team]: null },
        },
        expectedStep: step,
        requestId: rid(),
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("moved to another question") as unknown,
    });
    expect((await sq.hostView()).state?.grades).toEqual({});
  });

  it("a deleted team never blocks the reveal", async () => {
    const { game, admin, sq, players } = await readyQuiz({ teams: 2 });
    const [ada, bea] = players;
    await act(sq, { type: "next" });
    await act(sq, { type: "lock" });
    await act(sq, {
      type: "grade",
      teams: [ada!.team],
      verdict: "correct",
      from: { [ada!.team]: null },
    });
    await expect(act(sq, { type: "reveal" })).rejects.toMatchObject({
      message: expect.stringContaining("1 still unmarked") as unknown,
    });
    await admin.gameAdmin.removeTeam({ gameTeamId: bea!.team });
    await act(sq, { type: "reveal" });
    expect((await currentScores(game.id))[ada!.team]).toBe(10);
  });

  it("voids without points and finishes, then hands back to basic controls", async () => {
    const { game, sq, players } = await readyQuiz();
    const [ada] = players;
    await act(sq, { type: "next" });
    await submit(ada!, {
      text: "Six",
      baseRevision: 0,
    });
    await act(sq, { type: "void" });
    const state = await requestCaller({}).public.currentGameState({
      gameId: game.id,
    });
    expect(quizView(state.mode)).toMatchObject({
      voided: true,
      question: { answer: null },
    });
    expect(Object.values(await currentScores(game.id))).toEqual([0, 0]);

    await act(sq, { type: "next" });
    await sq.end();
    const ended = await requestCaller({}).public.currentGameState({
      gameId: game.id,
    });
    expect(ended.mode?.status).toBe("ended");
    expect(ended.game.isBuzzerListening).toBe(false);
    await expect(
      submit(ada!, {
        text: "Six",
        baseRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await ada!.player.sequentialQuiz.myAnswer()).toMatchObject({
      open: false,
      answer: null,
    });
  });
});
