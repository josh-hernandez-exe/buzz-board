/**
 * The engine against the reference model's worked examples
 * (tests/unit/rankedAnswersSpec.test.ts): the same scenarios, played one
 * host action at a time, must give the same points.
 */
import { describe, expect, it } from "vitest";

import pack from "../../../tests/fixtures/ranked-answers/synthetic-pack.json";
import {
  playAllPlay,
  playFaceOffBoard,
  playRoundRobin,
  type Board as ModelBoard,
  type Rules as ModelRules,
} from "../../../tests/fixtures/ranked-answers/referenceModel";

import { contentSchema, preflight, type Content, type Rules } from "./content";
import { apply, initialState, type Action, type EngineState } from "./engine";

const modelRules = pack.rules as ModelRules;
const modelBoards = pack.boards as ModelBoard[];

/** The synthetic pack in the app's content format (rows in rank order). */
function contentFor(style: Rules["playStyle"], extra: Partial<Rules> = {}) {
  return contentSchema.parse({
    rules: {
      playStyle: style,
      pointValuesByRank: modelRules.pointValuesByRank,
      multiplier: modelRules.multiplier,
      strikes: modelRules.strikes,
      turnCycles: modelRules.turnCycles,
      allPlayRounds: modelRules.allPlayRounds,
      faceOffMethod: "buzzer",
      ...extra,
    },
    boards: modelBoards.map((b) => ({
      id: b.id,
      role: b.role,
      prompt: b.prefix,
      multiplier: b.multiplier,
      answers: [...b.answers]
        .sort((x, y) => x.rank - y.rank)
        .map((a) => ({
          id: a.id,
          text: a.text,
          aliases: a.aliases,
          points: a.points,
        })),
    })),
  });
}

function run(content: Content, teams: string[], actions: Action[]) {
  let state: EngineState = initialState(teams);
  const totals: Record<string, number> = Object.fromEntries(
    teams.map((t) => [t, 0]),
  );
  for (const action of actions) {
    const step = apply(content, state, action)._unsafeUnwrap();
    state = step.state;
    for (const [t, p] of Object.entries(step.scores)) totals[t]! += p;
  }
  return { state, totals };
}

const model = (id: string) => modelBoards.find((b) => b.id === id)!;
const six = ["T1", "T2", "T3", "T4", "T5", "T6"];

describe("content", () => {
  it("the synthetic pack is valid content and passes preflight for each style", () => {
    expect(preflight(contentFor("classic"), 2).blocking).toEqual([]);
    expect(preflight(contentFor("faceOffLadder"), 6).blocking).toEqual([]);
    expect(preflight(contentFor("allPlay"), 30).blocking).toEqual([]);
  });

  it("blocks a style that doesn't fit the number of teams", () => {
    expect(preflight(contentFor("classic"), 4).blocking[0]).toMatch(
      /needs 2 teams; this game has 4/,
    );
  });
});

describe("classic matches the model", () => {
  it("face-off, play, three strikes, then a successful steal", () => {
    const content = contentFor("classic");
    const { state, totals } = run(
      content,
      ["A", "B"],
      [
        { type: "startBoard", boardId: "board-picnic" },
        {
          type: "faceOff",
          answers: [
            { team: "A", answerId: "blanket" },
            { team: "B", answerId: null },
          ],
        },
        { type: "playOrPass", play: true },
        { type: "answer", answerId: "water" },
        { type: "answer", answerId: null },
        { type: "answer", answerId: null },
        { type: "answer", answerId: null },
        { type: "steal", answers: { B: "sandwiches" } },
      ],
    );
    const expected = playFaceOffBoard(
      modelRules,
      model("board-picnic"),
      ["A", "B"],
      {
        faceOffRows: ["blanket"],
        control: "A",
        controlAnswers: [
          { kind: "accept", answerId: "water" },
          { kind: "miss" },
          { kind: "miss" },
          { kind: "miss" },
        ],
        steals: { B: { kind: "accept", answerId: "sandwiches" } },
      },
    );
    expect(totals).toEqual(expected.points);
    expect(state.board).toMatchObject({
      phase: "closed",
      bank: 50,
      bankWinners: ["B"],
    });
  });

  it("the top row wins a buzzer face-off at once; passing hands play over", () => {
    const content = contentFor("classic");
    const { state } = run(
      content,
      ["A", "B"],
      [
        { type: "startBoard", boardId: "board-picnic" },
        { type: "faceOff", answers: [{ team: "B", answerId: "blanket" }] },
        { type: "playOrPass", play: false },
      ],
    );
    expect(state.board).toMatchObject({
      faceOffWinner: "B",
      control: "A",
      phase: "control",
    });
  });

  it("a secret face-off on the same row is replayed, never decided by speed", () => {
    const content = contentFor("classic", { faceOffMethod: "secret" });
    const { state } = run(
      content,
      ["A", "B"],
      [
        { type: "startBoard", boardId: "board-picnic" },
        {
          type: "faceOff",
          answers: [
            { team: "A", answerId: "water" },
            { team: "B", answerId: "water" },
          ],
        },
      ],
    );
    expect(state.board).toMatchObject({
      phase: "faceOff",
      faceOffWinner: null,
    });
  });
});

describe("face-off ladder matches the model", () => {
  it("simultaneous steals: the highest row takes the bank, others score their row", () => {
    const content = contentFor("faceOffLadder");
    const { state, totals } = run(content, six, [
      { type: "startBoard", boardId: "board-picnic" },
      {
        type: "faceOff",
        answers: [
          { team: "T1", answerId: "blanket" },
          { team: "T2", answerId: null },
        ],
      },
      { type: "playOrPass", play: true },
      { type: "answer", answerId: null },
      { type: "answer", answerId: null },
      { type: "answer", answerId: null },
      {
        type: "steal",
        answers: {
          T2: "fruit",
          T3: "sandwiches",
          T4: "blanket",
          T5: null,
          T6: "umbrella",
        },
      },
    ]);
    const expected = playFaceOffBoard(modelRules, model("board-picnic"), six, {
      faceOffRows: ["blanket"],
      control: "T1",
      controlAnswers: [{ kind: "miss" }, { kind: "miss" }, { kind: "miss" }],
      steals: {
        T2: { kind: "accept", answerId: "fruit" },
        T3: { kind: "accept", answerId: "sandwiches" },
        T4: { kind: "accept", answerId: "blanket" },
        T5: { kind: "miss" },
        T6: { kind: "accept", answerId: "umbrella" },
      },
    });
    expect(totals).toEqual(expected.points);
    expect(state.board?.bankWinners).toEqual(["T3"]);
  });

  it("rotates the face-off pair each main board", () => {
    const content = contentFor("faceOffLadder");
    let { state } = run(content, six, [
      { type: "startBoard", boardId: "board-picnic" },
      { type: "closeBoard" },
    ]);
    state = apply(content, state, {
      type: "startBoard",
      boardId: "board-rainy-day",
    })._unsafeUnwrap().state;
    expect(state.board?.faceOffTeams).toEqual(["T3", "T4"]);
  });

  it("refuses a steal from the team that was playing", () => {
    const content = contentFor("faceOffLadder");
    const { state } = run(content, six, [
      { type: "startBoard", boardId: "board-picnic" },
      { type: "faceOff", answers: [{ team: "T1", answerId: "blanket" }] },
      { type: "playOrPass", play: true },
      { type: "answer", answerId: null },
      { type: "answer", answerId: null },
      { type: "answer", answerId: null },
    ]);
    expect(
      apply(content, state, { type: "steal", answers: { T1: "water" } }),
    ).toMatchObject({ error: { kind: "unknownTeam", team: "T1" } });
  });
});

describe("round robin matches the model", () => {
  it("six teams, 12 turns, misses and duplicates score 0", () => {
    const content = contentFor("roundRobin");
    const ids = [
      "baking",
      null,
      "baking",
      null,
      "movie",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    const { state, totals } = run(content, six, [
      { type: "startBoard", boardId: "board-rainy-day" },
      ...ids.map((answerId): Action => ({ type: "answer", answerId })),
    ]);
    const expected = playRoundRobin(
      modelRules,
      model("board-rainy-day"),
      six,
      ids.map((id) =>
        id ? { kind: "accept", answerId: id } : { kind: "miss" as const },
      ),
    );
    expect(totals).toEqual(expected.points);
    expect(state.board?.phase).toBe("closed");
    expect(
      apply(content, state, { type: "answer", answerId: "reading" }),
    ).toMatchObject({ error: { kind: "wrongPhase" } });
  });
});

describe("all-play matches the model", () => {
  it("ten teams; several score the same row; earlier rows score 0", () => {
    const content = contentFor("allPlay");
    const teams = Array.from({ length: 10 }, (_, i) => `T${i + 1}`);
    const rounds: Record<string, string | null>[] = [
      { T1: "movie", T2: "movie", T3: "baking", T4: null, T5: null },
      { T1: "movie", T6: "reading", T7: "puzzle" },
    ];
    const { totals } = run(content, teams, [
      { type: "startBoard", boardId: "board-rainy-day" },
      ...rounds.map((answers): Action => ({ type: "allPlayRound", answers })),
    ]);
    const expected = playAllPlay(
      modelRules,
      model("board-rainy-day"),
      teams,
      rounds,
    );
    expect(totals).toEqual(expected.points);
  });
});

describe("points and boards", () => {
  it("double-points board with survey counts", () => {
    const content = contentFor("roundRobin");
    const { totals } = run(
      content,
      ["A", "B"],
      [
        { type: "startBoard", boardId: "board-holiday-dinner" },
        { type: "answer", answerId: "turkey" },
      ],
    );
    expect(totals).toEqual({ A: 76, B: 0 });
  });

  it("practice boards play normally but never change scores", () => {
    const content = contentFor("roundRobin");
    const { totals, state } = run(
      content,
      ["A", "B"],
      [
        { type: "startBoard", boardId: "practice-toolbox" },
        { type: "answer", answerId: "hammer" },
      ],
    );
    expect(totals).toEqual({ A: 0, B: 0 });
    expect(state.board?.revealed).toHaveLength(1);
    expect(state.mainStarted).toBe(0);
  });

  it("a spare board can be played by just the tied teams", () => {
    const content = contentFor("faceOffLadder");
    const { state } = run(content, six, [
      { type: "startBoard", boardId: "spare-breakfast", teams: ["T2", "T5"] },
    ]);
    expect(state.board).toMatchObject({
      teams: ["T2", "T5"],
      faceOffTeams: ["T2", "T5"],
    });
  });

  it("closing reveals leftovers for 0, and a board can't be played twice", () => {
    const content = contentFor("roundRobin");
    const { state } = run(
      content,
      ["A", "B"],
      [
        { type: "startBoard", boardId: "spare-breakfast" },
        { type: "answer", answerId: "eggs" },
        { type: "closeBoard" },
        { type: "revealRemaining" },
      ],
    );
    expect(state.board?.revealed.filter((r) => r.leftover)).toHaveLength(3);
    expect(
      apply(content, state, { type: "startBoard", boardId: "spare-breakfast" }),
    ).toMatchObject({ error: { kind: "boardAlreadyPlayed" } });
  });

  it("closing a face-off board early gives the bank to the playing team", () => {
    const content = contentFor("classic");
    const { totals } = run(
      content,
      ["A", "B"],
      [
        { type: "startBoard", boardId: "board-picnic" },
        { type: "faceOff", answers: [{ team: "A", answerId: "blanket" }] },
        { type: "playOrPass", play: true },
        { type: "answer", answerId: "water" },
        { type: "closeBoard" },
      ],
    );
    expect(totals).toEqual({ A: 50, B: 0 });
  });
});

describe("undo", () => {
  it("restores the previous state, but a shown answer stays shown for 0", async () => {
    const { undoTo } = await import("./engine");
    const content = contentFor("roundRobin");
    const { state: before } = run(
      content,
      ["A", "B"],
      [{ type: "startBoard", boardId: "spare-breakfast" }],
    );
    const after = apply(content, before, {
      type: "answer",
      answerId: "toast",
    })._unsafeUnwrap();
    expect(after.scores).toEqual({ A: 30 });

    const undone = undoTo(after.state, before);
    expect(undone.board).toMatchObject({
      turn: 0,
      awarded: {},
      revealed: [{ rank: 1, teams: [], points: 0, leftover: true }],
    });
    // Nobody can score the shown row now.
    const retry = apply(content, undone, {
      type: "answer",
      answerId: "toast",
    })._unsafeUnwrap();
    expect(retry.scores).toEqual({});
  });
});
