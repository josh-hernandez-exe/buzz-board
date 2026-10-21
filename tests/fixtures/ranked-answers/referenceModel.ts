/**
 * Executable worked examples of the **proposed** Ranked Answers rules
 * (docs/pr13-ranked-answers-event-spec.md). A review aid, not the runtime:
 * the mode itself is built later and these examples become its acceptance
 * tests. Pure, and never imported by the app.
 */

/**
 * How turns work. Each suits a range of team counts:
 * - classic: the TV-show format for exactly 2 teams (face-off, play or
 *   pass, strikes, one steal, the winner takes the bank).
 * - faceOffLadder: classic for 3-8 teams. Two teams face off each board
 *   (pairs rotate); every other team gets a secret steal answer.
 * - roundRobin: 2+ teams take one answer each in turn; whoever finds a row
 *   scores it.
 * - allPlay: any number of teams (best for 6+). Every team answers
 *   secretly at the same time each round; every team that finds a row
 *   scores it.
 */
export type PlayStyle = "classic" | "faceOffLadder" | "roundRobin" | "allPlay";

export const STYLE_TEAM_RANGE: Record<PlayStyle, [number, number]> = {
  classic: [2, 2],
  faceOffLadder: [3, 8],
  roundRobin: [2, 12],
  allPlay: [2, 50],
};

export type Rules = {
  playStyle: PlayStyle;
  /** Default points by rank (rank 1 first). Positive, strictly decreasing. */
  pointValuesByRank: number[];
  /** Whole-number multiplier for every board unless a board sets its own. */
  multiplier: number;
  /** Wrong answers a controlling team may give (classic, faceOffLadder). */
  strikes: number;
  /** Answers per team per board (roundRobin). */
  turnCycles: number;
  /** Rounds of simultaneous answers per board (allPlay). */
  allPlayRounds: number;
  consultationSeconds: number;
  answerSeconds: number;
  roundTargetSeconds: number;
};

export type Answer = {
  id: string;
  rank: number;
  text: string;
  aliases: string[];
  /** Points for this row, overriding rank points (for example a survey count). */
  points?: number;
};

export type Board = {
  id: string;
  role: "practice" | "main" | "spare";
  prefix: string;
  /** Capture record; "synthetic" for invented practice content. */
  source: { kind: "synthetic" | "captured"; note: string };
  /** Rank points for this board only. */
  pointValues?: number[];
  /** For example 2 for a "double points" board. */
  multiplier?: number;
  answers: Answer[];
};

export type Outcome =
  | { kind: "accept"; answerId: string }
  | { kind: "miss" | "duplicate" | "pass" | "timeout" };

// ------------------------------------------------------------ points

export function pointsFor(rules: Rules, board: Board, answer: Answer): number {
  const base =
    answer.points ??
    (board.pointValues ?? rules.pointValuesByRank)[answer.rank - 1] ??
    0;
  return base * (board.multiplier ?? rules.multiplier);
}

export function boardTotal(rules: Rules, board: Board): number {
  return board.answers.reduce((s, a) => s + pointsFor(rules, board, a), 0);
}

// ------------------------------------------------------------ preflight

const strictlyDecreasing = (w: number[]) =>
  w.every((p, i) => Number.isInteger(p) && p > 0 && (i === 0 || p < w[i - 1]!));

export type Preflight = { blocking: string[]; warnings: string[] };

/** Problems that block starting, and warnings the host acknowledges. */
export function preflight(
  rules: Rules,
  boards: Board[],
  teamCount: number,
): Preflight {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const [min, max] = STYLE_TEAM_RANGE[rules.playStyle];
  if (teamCount < min || teamCount > max) {
    blocking.push(
      `${rules.playStyle} needs ${min === max ? min : `${min} to ${max}`} teams; this game has ${teamCount}`,
    );
  }
  if (!strictlyDecreasing(rules.pointValuesByRank)) {
    blocking.push("rank points must be positive and strictly decreasing");
  }
  if (!Number.isInteger(rules.multiplier) || rules.multiplier < 1) {
    blocking.push("multiplier must be a positive whole number");
  }
  if (rules.strikes < 1 || rules.strikes > 5)
    blocking.push("strikes must be 1 to 5");
  if (rules.turnCycles < 1 || rules.turnCycles > 4) {
    blocking.push("turnCycles must be 1 to 4");
  }
  if (rules.allPlayRounds < 1 || rules.allPlayRounds > 8) {
    blocking.push("allPlayRounds must be 1 to 8");
  }
  if (rules.consultationSeconds + rules.answerSeconds <= 0) {
    blocking.push("consultation plus answer time must be positive");
  }

  const ids = new Set<string>();
  for (const board of boards) {
    if (ids.has(board.id))
      blocking.push(`board IDs must be unique (${board.id})`);
    ids.add(board.id);
    const n = board.answers.length;
    const weights = board.pointValues ?? rules.pointValuesByRank;
    if (n < 4 || n > 8) blocking.push(`${board.id}: needs 4 to 8 answers`);
    if (board.pointValues && !strictlyDecreasing(board.pointValues)) {
      blocking.push(
        `${board.id}: rank points must be positive and strictly decreasing`,
      );
    }
    if (
      board.multiplier !== undefined &&
      (!Number.isInteger(board.multiplier) || board.multiplier < 1)
    ) {
      blocking.push(`${board.id}: multiplier must be a positive whole number`);
    }
    const sorted = [...board.answers].sort((a, b) => a.rank - b.rank);
    if (sorted.some((a, i) => a.rank !== i + 1)) {
      blocking.push(`${board.id}: ranks must be 1 to ${n} with no gaps`);
    }
    if (new Set(board.answers.map((a) => a.id)).size !== n) {
      blocking.push(`${board.id}: answer IDs must be unique`);
    }
    if (sorted.some((a) => a.points === undefined) && n > weights.length) {
      blocking.push(`${board.id}: more rows than rank points`);
    }
    const custom = sorted.map((a) => a.points);
    if (custom.some((p) => p !== undefined)) {
      if (custom.some((p) => p === undefined)) {
        blocking.push(`${board.id}: give every row points, or none`);
      } else if (
        custom.some(
          (p, i) =>
            !Number.isInteger(p) || p! <= 0 || (i > 0 && p! > custom[i - 1]!),
        )
      ) {
        blocking.push(
          `${board.id}: row points must be positive and never higher than the row above`,
        );
      }
    }
  }

  const main = boards.filter((b) => b.role === "main");
  const totals = new Set(main.map((b) => boardTotal(rules, b)));
  if (totals.size > 1) {
    warnings.push("main boards are worth different totals");
  }
  if (rules.playStyle === "roundRobin" && main.length % teamCount !== 0) {
    warnings.push(
      `${main.length} boards don't give each of ${teamCount} teams the same number of first turns`,
    );
  }
  if (
    rules.playStyle === "faceOffLadder" &&
    (main.length * 2) % teamCount !== 0
  ) {
    warnings.push(
      `${main.length} boards don't give each of ${teamCount} teams the same number of face-offs`,
    );
  }
  if (!boards.some((b) => b.role === "spare")) {
    warnings.push("no spare board for a tie-break");
  }
  return { blocking, warnings };
}

// ------------------------------------------------------------ helpers

type Ledger = Record<string, number>;
const ledger = (teams: string[]): Ledger =>
  Object.fromEntries(teams.map((t) => [t, 0]));

function hiddenRow(board: Board, revealed: string[], outcome: Outcome) {
  if (outcome.kind !== "accept" || revealed.includes(outcome.answerId)) {
    return undefined;
  }
  return board.answers.find((a) => a.id === outcome.answerId);
}

function leftovers(board: Board, revealed: string[]) {
  return board.answers
    .filter((a) => !revealed.includes(a.id))
    .sort((a, b) => a.rank - b.rank)
    .map((a) => a.id);
}

/** Starting order for a board: the frozen order rotated one place per board. */
export function turnOrder(teams: string[], boardIndex: number): string[] {
  const start = boardIndex % teams.length;
  return [...teams.slice(start), ...teams.slice(0, start)];
}

// ------------------------------------------------------------ face-off

export type FaceOffAnswer = { team: string; answerId: string | null };

/**
 * Who wins a face-off. The first to buzz answers; the top row wins at once.
 * Otherwise the other team answers and the higher row wins. If neither finds
 * a row, the host runs another face-off (null).
 */
export function faceOffWinner(
  board: Board,
  first: FaceOffAnswer,
  second: FaceOffAnswer | null,
): string | null {
  const rank = (a: FaceOffAnswer | null) =>
    board.answers.find((r) => r.id === a?.answerId)?.rank ?? Infinity;
  if (rank(first) === 1 || !second) {
    return rank(first) === Infinity ? null : first.team;
  }
  if (rank(first) === Infinity && rank(second) === Infinity) return null;
  return rank(first) <= rank(second) ? first.team : second.team;
}

/**
 * Face-off without a buzzer race, for remote play: both teams answer
 * secretly and the higher row wins. The same row (or neither finding one)
 * means another face-off (null): nobody wins on network speed.
 */
export function secretFaceOffWinner(
  board: Board,
  a: FaceOffAnswer,
  b: FaceOffAnswer,
): string | null {
  const rank = (x: FaceOffAnswer) =>
    board.answers.find((r) => r.id === x.answerId)?.rank ?? Infinity;
  if (rank(a) === rank(b)) return null;
  return rank(a) < rank(b) ? a.team : b.team;
}

/** The two teams facing off on board `boardIndex` (faceOffLadder). */
export function faceOffPair(
  teams: string[],
  boardIndex: number,
): [string, string] {
  const n = teams.length;
  return [teams[(2 * boardIndex) % n]!, teams[(2 * boardIndex + 1) % n]!];
}

// ------------------------------------------------------------ classic + ladder

export type BankResult = {
  points: Ledger;
  revealed: string[];
  leftovers: string[];
  strikes: number;
  /** Teams that took the bank. */
  bankWinners: string[];
  bank: number;
};

/**
 * Classic (2 teams) and faceOffLadder (3-8 teams) after the face-off.
 * Face-off rows and every row the controlling team finds go into the bank.
 * The controlling team keeps answering until the board is cleared (they
 * take the bank) or they reach the strike limit. Then the other team
 * (classic) or every other team (ladder) gives one secret steal answer:
 * - no steal finds a hidden row: the controlling team takes the bank;
 * - otherwise the team(s) with the highest steal row take the bank plus
 *   their row. Other correct steals score only their own row.
 * Ties go to every tied team: there's never a race on network speed.
 */
export function playFaceOffBoard(
  rules: Rules,
  board: Board,
  teams: string[],
  {
    faceOffRows,
    control,
    controlAnswers,
    steals,
  }: {
    faceOffRows: string[];
    control: string;
    controlAnswers: Outcome[];
    steals: Record<string, Outcome>;
  },
): BankResult {
  const points = ledger(teams);
  const revealed: string[] = [...faceOffRows];
  let bank = faceOffRows.reduce(
    (s, id) =>
      s + pointsFor(rules, board, board.answers.find((a) => a.id === id)!),
    0,
  );
  let strikes = 0;
  const cleared = () => revealed.length === board.answers.length;

  for (const outcome of controlAnswers) {
    if (cleared() || strikes >= rules.strikes) break;
    const row = hiddenRow(board, revealed, outcome);
    if (row) {
      revealed.push(row.id);
      bank += pointsFor(rules, board, row);
    } else {
      strikes++;
    }
  }

  let bankWinners = [control];
  if (!cleared() && strikes >= rules.strikes) {
    const hits = Object.entries(steals)
      .filter(([team]) => team !== control)
      .map(([team, outcome]) => ({
        team,
        row: hiddenRow(board, revealed, outcome),
      }))
      .filter(
        (h): h is { team: string; row: Board["answers"][number] } => !!h.row,
      );
    if (hits.length > 0) {
      const best = Math.min(...hits.map((h) => h.row.rank));
      bankWinners = hits.filter((h) => h.row.rank === best).map((h) => h.team);
      for (const { team, row } of hits) {
        if (!revealed.includes(row.id)) revealed.push(row.id);
        points[team]! += pointsFor(rules, board, row);
      }
    }
  }
  for (const team of bankWinners) points[team]! += bank;
  return {
    points,
    revealed,
    leftovers: leftovers(board, revealed),
    strikes,
    bankWinners,
    bank,
  };
}

// ------------------------------------------------------------ round robin

export type RowResult = {
  points: Ledger;
  revealed: string[];
  leftovers: string[];
  turnsUsed: number;
  closedBy: "allFound" | "outOfTurns" | "host";
};

/**
 * Teams answer one at a time in the rotated order, `turnCycles` times
 * around. The first accepted hidden row scores for that team; a miss,
 * duplicate, pass or timeout scores 0 and uses the turn.
 */
export function playRoundRobin(
  rules: Rules,
  board: Board,
  order: string[],
  outcomes: Outcome[],
  hostClosesAfter = Infinity,
): RowResult {
  const points = ledger(order);
  const revealed: string[] = [];
  const maxTurns = order.length * rules.turnCycles;
  let turn = 0;
  let closedBy: RowResult["closedBy"] = "outOfTurns";
  while (turn < maxTurns) {
    if (revealed.length === board.answers.length) break;
    const outcome = outcomes[turn];
    if (turn >= hostClosesAfter || !outcome) {
      closedBy = "host";
      break;
    }
    const row = hiddenRow(board, revealed, outcome);
    if (row) {
      revealed.push(row.id);
      points[order[turn % order.length]!]! += pointsFor(rules, board, row);
    }
    turn++;
  }
  if (revealed.length === board.answers.length) closedBy = "allFound";
  return {
    points,
    revealed,
    leftovers: leftovers(board, revealed),
    turnsUsed: turn,
    closedBy,
  };
}

// ------------------------------------------------------------ all-play

/**
 * Every team submits one secret answer per round. When the host reveals,
 * each team whose answer is a row still hidden at the start of the round
 * scores that row, so several teams can score the same row. Rows found in
 * earlier rounds score 0. Stops after `allPlayRounds` or when every row is
 * revealed. Time per round doesn't grow with the number of teams.
 */
export function playAllPlay(
  rules: Rules,
  board: Board,
  teams: string[],
  rounds: Record<string, string | null>[],
): RowResult {
  const points = ledger(teams);
  const revealed: string[] = [];
  let used = 0;
  for (const round of rounds.slice(0, rules.allPlayRounds)) {
    if (revealed.length === board.answers.length) break;
    const hiddenAtStart = new Set(
      board.answers.filter((a) => !revealed.includes(a.id)).map((a) => a.id),
    );
    for (const team of teams) {
      const id = round[team];
      if (!id || !hiddenAtStart.has(id)) continue;
      const row = board.answers.find((a) => a.id === id)!;
      points[team]! += pointsFor(rules, board, row);
      if (!revealed.includes(id)) revealed.push(id);
    }
    used++;
  }
  return {
    points,
    revealed,
    leftovers: leftovers(board, revealed),
    turnsUsed: used,
    closedBy:
      revealed.length === board.answers.length ? "allFound" : "outOfTurns",
  };
}
