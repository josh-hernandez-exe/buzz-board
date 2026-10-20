/**
 * Executable worked examples of the **proposed** Ranked Answers rules
 * (docs/pr13-ranked-answers-event-spec.md). A review aid, not the runtime:
 * the mode itself is built through Game Kit in PR16/PR22 once the rules
 * are approved. Pure, and never imported by the app.
 */

export type Rules = {
  turnCycles: number;
  consultationSeconds: number;
  answerSeconds: number;
  roundTargetSeconds: number;
  pointValuesByRank: number[];
  multiplier: number;
};

export type Board = {
  id: string;
  role: "practice" | "main" | "spare";
  prefix: string;
  /** Capture record; "synthetic" for invented practice content. */
  source: { kind: "synthetic" | "captured"; note: string };
  answers: { id: string; rank: number; text: string; aliases: string[] }[];
};

export type Outcome =
  | { kind: "accept"; answerId: string }
  | { kind: "miss" | "duplicate" | "pass" | "timeout" };

/** Problems that block starting, as preflight would report them. */
export function rulesProblems(rules: Rules, boards: Board[]): string[] {
  const problems: string[] = [];
  const w = rules.pointValuesByRank;
  if (rules.turnCycles < 1 || rules.turnCycles > 4) {
    problems.push("turnCycles must be 1 to 4");
  }
  if (rules.consultationSeconds + rules.answerSeconds <= 0) {
    problems.push("consultation plus answer time must be positive");
  }
  if (!Number.isInteger(rules.multiplier) || rules.multiplier < 1) {
    problems.push("multiplier must be a positive whole number");
  }
  if (
    w.some(
      (p, i) => !Number.isInteger(p) || p <= 0 || (i > 0 && p >= w[i - 1]!),
    )
  ) {
    problems.push("rank points must be positive and strictly decreasing");
  }
  for (const board of boards) {
    const n = board.answers.length;
    if (n < 4 || n > 8) problems.push(`${board.id}: needs 4 to 8 answers`);
    if (n > w.length) problems.push(`${board.id}: more rows than rank points`);
    const ranks = board.answers.map((a) => a.rank).sort((a, b) => a - b);
    if (ranks.some((r, i) => r !== i + 1)) {
      problems.push(`${board.id}: ranks must be 1 to ${n} with no gaps`);
    }
    const ids = new Set(board.answers.map((a) => a.id));
    if (ids.size !== n) problems.push(`${board.id}: answer IDs must be unique`);
  }
  const boardIds = new Set(boards.map((b) => b.id));
  if (boardIds.size !== boards.length)
    problems.push("board IDs must be unique");
  return problems;
}

/** Points for revealing the row at `rank`. */
export function pointsFor(rules: Rules, rank: number): number {
  return (rules.pointValuesByRank[rank - 1] ?? 0) * rules.multiplier;
}

/**
 * Team order for board `boardIndex` (0-based among main boards): the frozen
 * team order rotated so the starting team moves one place per board. Not
 * based on scores or who seems online.
 */
export function turnOrder(teams: string[], boardIndex: number): string[] {
  const start = boardIndex % teams.length;
  return [...teams.slice(start), ...teams.slice(0, start)];
}

export type BoardResult = {
  /** Points per team from this board. */
  points: Record<string, number>;
  revealed: string[];
  /** Rows revealed for zero when the board closed. */
  leftovers: string[];
  turnsUsed: number;
  closedBy: "allFound" | "outOfTurns" | "host";
};

/**
 * Plays one board: each outcome consumes the current team's opportunity.
 * Only a first accepted unrevealed row scores. `hostClosesAfter` models the
 * host closing for time after that many turns.
 */
export function playBoard(
  rules: Rules,
  board: Board,
  order: string[],
  outcomes: Outcome[],
  hostClosesAfter = Infinity,
): BoardResult {
  const points: Record<string, number> = Object.fromEntries(
    order.map((t) => [t, 0]),
  );
  const revealed: string[] = [];
  const maxTurns = order.length * rules.turnCycles;
  let turn = 0;
  let closedBy: BoardResult["closedBy"] = "outOfTurns";
  while (turn < maxTurns) {
    if (revealed.length === board.answers.length) {
      closedBy = "allFound";
      break;
    }
    const outcome = outcomes[turn];
    if (turn >= hostClosesAfter || !outcome) {
      closedBy = "host";
      break;
    }
    const team = order[turn % order.length]!;
    if (outcome.kind === "accept" && !revealed.includes(outcome.answerId)) {
      const answer = board.answers.find((a) => a.id === outcome.answerId);
      if (answer) {
        revealed.push(answer.id);
        points[team]! += pointsFor(rules, answer.rank);
      }
    }
    turn++;
  }
  if (revealed.length === board.answers.length) closedBy = "allFound";
  return {
    points,
    revealed,
    leftovers: board.answers
      .filter((a) => !revealed.includes(a.id))
      .sort((a, b) => a.rank - b.rank)
      .map((a) => a.id),
    turnsUsed: turn,
    closedBy,
  };
}
