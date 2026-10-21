/**
 * Randomised games through the engine: for every preset, many team counts
 * and seeds, play random legal (and some illegal) host actions with random
 * undos, and check the rules' invariants after every step. A failure prints
 * the seed so it can be replayed.
 */
import { describe, expect, it } from "vitest";

import {
  boardTotal,
  contentSchema,
  PRESETS,
  presetRules,
  resolveRules,
  type Content,
  type PresetId,
  type Rules,
} from "./content";
import {
  apply,
  currentTurnTeam,
  initialState,
  stealersOf,
  undoTo,
  type Action,
  type BoardState,
  type EngineState,
} from "./engine";

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  };
}

const ROWS = [50, 40, 30, 20, 10, 5];

function makeContent(rules: Rules): Content {
  const board = (id: string, role: "main" | "practice" | "spare") => ({
    id,
    role,
    prompt: id,
    answers: ROWS.map((points, i) => ({
      id: `${id}-${i + 1}`,
      text: `${id} ${i + 1}`,
      aliases: [],
      points,
    })),
    ...(id === "m3" ? { multiplier: 2 } : {}),
  });
  return contentSchema.parse({
    rules,
    boards: [
      board("p", "practice"),
      board("m1", "main"),
      board("m2", "main"),
      board("m3", "main"),
      board("m4", "main"),
      board("s", "spare"),
    ],
  });
}

type Sim = {
  state: EngineState;
  totals: Record<string, number>;
  history: { state: EngineState; scores: Record<string, number> }[];
};

/** A random action that fits the current phase, sometimes a wrong one. */
function randomAction(
  r: ReturnType<typeof rng>,
  content: Content,
  state: EngineState,
): Action {
  const b = state.board;
  const remaining = content.boards.filter(
    (x) => !state.boardsPlayed.includes(x.id),
  );
  if (b && r.chance(0.03)) return { type: "voidBoard" };
  if (!b || b.phase === "closed") {
    if (b && r.chance(0.2)) return { type: "revealRemaining" };
    const next = remaining.length > 0 ? r.pick(remaining) : null;
    if (!next || r.chance(0.02)) return { type: "finish" };
    const teams =
      next.role === "spare" && state.teams.length > 2 && r.chance(0.5)
        ? state.teams.slice(0, 2)
        : undefined;
    return { type: "startBoard", boardId: next.id, teams };
  }
  if (r.chance(0.04)) return { type: "closeBoard" };
  const board = content.boards.find((x) => x.id === b.boardId)!;
  const anyAnswer = () => (r.chance(0.3) ? null : r.pick(board.answers).id); // may be already shown
  const someTeam = (teams: string[]) => r.pick(teams);
  switch (b.phase) {
    case "faceOff": {
      const order = r.chance(0.5)
        ? b.faceOffTeams
        : [...b.faceOffTeams].reverse();
      const n = r.chance(0.15) ? 1 : order.length;
      return {
        type: "faceOff",
        answers: order
          .slice(0, n)
          .map((team) => ({ team, answerId: anyAnswer() })),
      };
    }
    case "playOrPass":
      return { type: "playOrPass", play: r.chance(0.6) };
    case "control":
    case "turns":
      return { type: "answer", answerId: anyAnswer() };
    case "steal": {
      const stealers = stealersOf(content.rules, b);
      const who = r.chance(0.1)
        ? [someTeam(b.teams)] // sometimes a team that may not steal
        : stealers.filter(() => r.chance(0.8));
      return {
        type: "steal",
        answers: Object.fromEntries(who.map((t) => [t, anyAnswer()])),
      };
    }
    case "allPlay":
      return {
        type: "allPlayRound",
        answers: Object.fromEntries(
          b.teams.filter(() => r.chance(0.8)).map((t) => [t, anyAnswer()]),
        ),
      };
    case "open":
      return r.chance(0.2)
        ? { type: "miss", team: someTeam(b.teams) }
        : {
            type: "credit",
            answerId: r.pick(board.answers).id,
            teams: b.teams.filter(() => r.chance(0.3)),
          };
    case "race":
      return {
        type: "raceAnswer",
        team: someTeam(b.teams),
        answerId: anyAnswer(),
      };
    default:
      return { type: "closeBoard" };
  }
}

const isFaceOff = (c: Content) =>
  c.rules.playStyle === "classic" || c.rules.playStyle === "faceOffLadder";

function checkInvariants(
  content: Content,
  sim: Sim,
  before: EngineState,
  action: Action,
  scores: Record<string, number>,
  label: string,
) {
  const rules = resolveRules(content.rules);
  const b = sim.state.board;
  if (!b) return;
  const board = content.boards.find((x) => x.id === b.boardId)!;
  // Rows: unique, in range.
  const ranks = b.revealed.map((x) => x.rank);
  expect(new Set(ranks).size, `${label}: a row revealed twice`).toBe(
    ranks.length,
  );
  for (const rank of ranks) {
    expect(rank >= 1 && rank <= board.answers.length, label).toBe(true);
  }
  // Leftovers are worth nothing.
  for (const row of b.revealed.filter((x) => x.leftover)) {
    expect(row.points, label).toBe(0);
  }
  // A row once shown stays shown (also across undo).
  const prev = before.board;
  if (prev?.boardId === b.boardId) {
    for (const row of prev.revealed) {
      expect(ranks.includes(row.rank), `${label}: a shown row was hidden`).toBe(
        true,
      );
    }
  }
  // Bank: only rows banked (no team credited) count, and only in bank mode.
  if (rules.scoring === "direct") expect(b.bank, label).toBe(0);
  if (board.role === "practice") {
    expect(
      Object.values(scores).every((p) => p === 0),
      label,
    ).toBe(true);
  }
  // Without penalties, nobody loses points.
  // Without penalties, nobody loses points (except a void taking them back).
  if (rules.missPenalty === 0 && action.type !== "voidBoard") {
    for (const p of Object.values(scores)) expect(p >= 0, label).toBe(true);
  }
  // Points stay within what the board is worth when each row can only pay
  // once and the bank only once.
  // Simultaneous answers (all-play, everyone stealing) can pay the same row
  // to several teams by design.
  const style = content.rules.playStyle;
  const onePayout =
    style === "allPlay" || style === "open"
      ? rules.sharedAnswers !== "full"
      : !isFaceOff(content) || rules.stealBy !== "everyone";
  if (onePayout && rules.missPenalty === 0) {
    const paid = Object.values(b.awarded).reduce((s, p) => s + p, 0);
    const worth =
      board.role === "practice" ? 0 : boardTotal(content.rules, board);
    expect(paid <= worth, `${label}: paid ${paid} of ${worth}`).toBe(true);
  }
  // Lockouts only name playing teams.
  for (const t of b.lockedOut ?? [])
    expect(b.teams.includes(t), label).toBe(true);
  // Turn styles: whoever answered was the team whose turn it was.
  if (action.type === "answer" && prev?.phase === "turns") {
    const team = currentTurnTeam(prev);
    for (const t of Object.keys(scores)) expect(t, label).toBe(team);
  }
  if (action.type === "answer" && prev?.phase === "control") {
    for (const t of Object.keys(scores)) {
      // Points go to the playing team (direct) or the bank winner.
      expect(
        t === prev.control || b.phase === "closed",
        `${label}: control points to ${t}`,
      ).toBe(true);
    }
  }
}

function play(preset: PresetId, teamCount: number, seed: number) {
  const r = rng(seed);
  const teams = Array.from({ length: teamCount }, (_, i) => `T${i + 1}`);
  let rules = presetRules(preset, teamCount);
  if (r.chance(0.3)) rules = { ...rules, missPenalty: 3 };
  if (r.chance(0.3)) rules = { ...rules, scoring: "direct" };
  if (r.chance(0.3)) rules = { ...rules, allowPass: false };
  if (r.chance(0.2)) rules = { ...rules, stealReward: "rowOnly" };
  if (r.chance(0.2) && preset === "buzzRace") {
    rules = {
      ...rules,
      raceLockout: r.pick(["afterStrikes", "none"] as const),
    };
  }
  if (r.chance(0.3) && preset === "open") {
    rules = {
      ...rules,
      sharedAnswers: r.pick(["split", "uniqueOnly"] as const),
    };
  }
  if (r.chance(0.2) && preset === "allPlay") {
    rules = { ...rules, sharedAnswers: "split" };
  }
  const content = makeContent(rules);
  const sim: Sim = {
    state: initialState(teams),
    totals: Object.fromEntries(teams.map((t) => [t, 0])),
    history: [],
  };
  // Every board that has ever shown a row to players. It must never become
  // playable again, or those rows would be hidden again.
  const shown = new Set<string>();
  const noteShown = (st: EngineState) => {
    if (st.board && st.board.revealed.length > 0) shown.add(st.board.boardId);
  };
  const checkShown = (st: EngineState, label: string) => {
    for (const id of shown) {
      expect(
        st.boardsPlayed.includes(id),
        `${label}: board ${id} showed rows but can be played again`,
      ).toBe(true);
    }
  };
  for (let i = 0; i < 250 && !sim.state.finished; i++) {
    const label = `${preset} ${teamCount} teams seed ${seed} step ${i}`;
    if (sim.history.length > 0 && r.chance(0.08)) {
      const last = sim.history.pop()!;
      const before = sim.state;
      sim.state = undoTo(sim.state, last.state);
      checkShown(sim.state, label);
      for (const [t, p] of Object.entries(last.scores)) sim.totals[t]! -= p;
      // Undo never hides a shown row.
      if (before.board && sim.state.board?.boardId === before.board.boardId) {
        for (const row of before.board.revealed) {
          expect(
            sim.state.board.revealed.some((x) => x.rank === row.rank),
            `${label}: undo hid a row`,
          ).toBe(true);
        }
      }
      continue;
    }
    const action = randomAction(r, content, sim.state);
    const result = apply(content, sim.state, action);
    if (process.env.TRACE === label.split(" step")[0]) {
      console.log(
        i,
        JSON.stringify(action),
        result.isOk()
          ? JSON.stringify(result.value.scores) +
              " " +
              result.value.state.board?.phase +
              " bank " +
              result.value.state.board?.bank
          : "ERR " + JSON.stringify(result.error),
      );
    }
    if (result.isErr()) continue; // refused: nothing changed
    const before = sim.state;
    const { state, scores } = result.value;
    sim.history.push({ state: before, scores });
    sim.state = state;
    noteShown(state);
    checkShown(state, label);
    for (const [t, p] of Object.entries(scores)) {
      expect(teams.includes(t), `${label}: points to unknown ${t}`).toBe(true);
      sim.totals[t]! += p;
    }
    // Board points match the scores reported for this board.
    if (state.board && before.board?.boardId === state.board.boardId) {
      for (const t of teams) {
        expect(
          (state.board.awarded[t] ?? 0) - (before.board.awarded[t] ?? 0),
          `${label}: awarded vs scores for ${t}`,
        ).toBe(scores[t] ?? 0);
      }
    }
    checkInvariants(content, sim, before, action, scores, label);
    if (action.type === "voidBoard" && before.board) {
      // A void takes back exactly what the board gave or took.
      for (const t of teams) {
        expect(scores[t] ?? 0, `${label}: void for ${t}`).toBe(
          0 - (before.board.awarded[t] ?? 0) || 0,
        );
      }
      expect(state.board!.phase, label).toBe("closed");
    }
  }
  // From wherever play stopped, the host can always close the board and
  // finish: no state is a dead end.
  if (!sim.state.finished) {
    let state = sim.state;
    if (state.board && state.board.phase !== "closed") {
      state = apply(content, state, { type: "closeBoard" })._unsafeUnwrap()
        .state;
    }
    expect(apply(content, state, { type: "finish" }).isOk()).toBe(true);
  }
  // Replaying the surviving history from scratch gives the same totals.
  const replayed = Object.fromEntries(teams.map((t) => [t, 0]));
  for (const h of sim.history) {
    for (const [t, p] of Object.entries(h.scores)) replayed[t]! += p;
  }
  expect(replayed).toEqual(sim.totals);
}

describe("randomised games keep every invariant", () => {
  for (const preset of PRESETS) {
    const counts = [
      preset.teams[0],
      Math.min(preset.teams[1], preset.teams[0] + 1),
      Math.min(preset.teams[1], 7),
    ];
    it(
      `${preset.label} (${[...new Set(counts)].join(", ")} teams)`,
      { timeout: 60_000 },
      () => {
        for (const n of new Set(counts)) {
          for (let seed = 1; seed <= 80; seed++) play(preset.id, n, seed);
        }
      },
    );
  }
});

describe("turn order", () => {
  const board = (b: BoardState) => b;
  const content = (rules: Partial<Rules>) =>
    makeContent({ ...presetRules("roundRobin", 4), ...rules });

  it("round robin: every team answers in order, and the first team moves on each main board", () => {
    const c = content({ turnCycles: 2 });
    const teams = ["A", "B", "C", "D"];
    let state = initialState(teams);
    const firsts: string[] = [];
    for (const id of ["m1", "p", "m2", "m3", "s", "m4"]) {
      state = apply(c, state, {
        type: "startBoard",
        boardId: id,
      })._unsafeUnwrap().state;
      const answered: string[] = [];
      while (state.board!.phase !== "closed") {
        answered.push(currentTurnTeam(board(state.board!))!);
        state = apply(c, state, {
          type: "answer",
          answerId: null,
        })._unsafeUnwrap().state;
      }
      expect(answered).toHaveLength(8);
      // Each team twice, in a fixed rotation.
      const start = teams.indexOf(answered[0]!);
      expect(answered).toEqual(
        Array.from({ length: 8 }, (_, i) => teams[(start + i) % 4]),
      );
      const role = c.boards.find((x) => x.id === id)!.role;
      if (role === "main") firsts.push(answered[0]!);
    }
    expect(firsts).toEqual(["A", "B", "C", "D"]);
  });

  it("face-off ladder: across boards every team faces off equally often", () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const teams = Array.from({ length: n }, (_, i) => `T${i}`);
      const c = makeContent({ ...presetRules("ladder", n) });
      const counts: Record<string, number> = {};
      let state = initialState(teams);
      // n boards: each team should face off exactly twice.
      const ids = Array.from({ length: n }, (_, i) => `x${i}`);
      const many = contentSchema.parse({
        ...c,
        boards: ids.map((id) => ({ ...c.boards[1]!, id })),
      });
      for (const id of ids) {
        state = apply(many, state, {
          type: "startBoard",
          boardId: id,
        })._unsafeUnwrap().state;
        for (const t of state.board!.faceOffTeams)
          counts[t] = (counts[t] ?? 0) + 1;
        state = apply(many, state, { type: "closeBoard" })._unsafeUnwrap()
          .state;
      }
      expect(Object.values(counts), `${n} teams`).toEqual(teams.map(() => 2));
    }
  });

  it("no face-off: every team plays the same number of boards", () => {
    for (const n of [2, 3, 5]) {
      const teams = Array.from({ length: n }, (_, i) => `T${i}`);
      const base = makeContent({
        ...presetRules(n === 2 ? "noFaceOff" : "ladder", n),
        faceOffMethod: "none",
      });
      const ids = Array.from({ length: n * 2 }, (_, i) => `x${i}`);
      const c = contentSchema.parse({
        ...base,
        boards: ids.map((id) => ({ ...base.boards[1]!, id })),
      });
      const counts: Record<string, number> = {};
      let state = initialState(teams);
      for (const id of ids) {
        state = apply(c, state, {
          type: "startBoard",
          boardId: id,
        })._unsafeUnwrap().state;
        const control = state.board!.control!;
        counts[control] = (counts[control] ?? 0) + 1;
        expect(state.board!.faceOffTeams[1]).not.toBe(control);
        state = apply(c, state, { type: "closeBoard" })._unsafeUnwrap().state;
      }
      expect(Object.values(counts), `${n} teams`).toEqual(teams.map(() => 2));
    }
  });

  it("a repeated face-off answer that's already on the board doesn't win", () => {
    const c = makeContent({
      ...presetRules("classic", 2),
      faceOffMethod: "secret",
    });
    let state = initialState(["A", "B"]);
    state = apply(c, state, {
      type: "startBoard",
      boardId: "m1",
    })._unsafeUnwrap().state;
    // Both give row 2: shown, no winner.
    state = apply(c, state, {
      type: "faceOff",
      answers: [
        { team: "A", answerId: "m1-2" },
        { team: "B", answerId: "m1-2" },
      ],
    })._unsafeUnwrap().state;
    expect(state.board!.phase).toBe("faceOff");
    // Again: A repeats row 2 (already shown), B finds row 5.
    state = apply(c, state, {
      type: "faceOff",
      answers: [
        { team: "A", answerId: "m1-2" },
        { team: "B", answerId: "m1-5" },
      ],
    })._unsafeUnwrap().state;
    expect(state.board!.faceOffWinner).toBe("B");
  });

  it("buzzer face-off: the top answer still hidden wins at once", () => {
    const c = makeContent({
      ...presetRules("classic", 2),
      faceOffMethod: "secret",
    });
    let state = initialState(["A", "B"]);
    state = apply(c, state, {
      type: "startBoard",
      boardId: "m1",
    })._unsafeUnwrap().state;
    state = apply(c, state, {
      type: "faceOff",
      answers: [
        { team: "A", answerId: "m1-1" },
        { team: "B", answerId: "m1-1" },
      ],
    })._unsafeUnwrap().state;
    const buzzer = makeContent({ ...presetRules("classic", 2) });
    state = apply(buzzer, state, {
      type: "faceOff",
      answers: [{ team: "B", answerId: "m1-2" }],
    })._unsafeUnwrap().state;
    // Row 1 is already shown, so row 2 is the top remaining: B wins outright.
    expect(state.board!.faceOffWinner).toBe("B");
  });

  it("refuses the same team twice in a face-off", () => {
    const c = makeContent(presetRules("classic", 2));
    let state = initialState(["A", "B"]);
    state = apply(c, state, {
      type: "startBoard",
      boardId: "m1",
    })._unsafeUnwrap().state;
    const twice = apply(c, state, {
      type: "faceOff",
      answers: [
        { team: "A", answerId: null },
        { team: "A", answerId: "m1-1" },
      ],
    });
    expect(twice._unsafeUnwrapErr().kind).toBe("badTeams");
  });
});
