/**
 * Ranked Answers content and rules: shared by the server (validation, the
 * engine) and the host's editor. Pure and browser-safe.
 */
import { z } from "zod";

export const PLAY_STYLES = [
  "classic",
  "faceOffLadder",
  "roundRobin",
  "allPlay",
] as const;
export type PlayStyle = (typeof PLAY_STYLES)[number];

/** Team counts each style supports. */
export const STYLE_TEAM_RANGE: Record<PlayStyle, [number, number]> = {
  classic: [2, 2],
  faceOffLadder: [3, 8],
  roundRobin: [2, 12],
  allPlay: [2, 50],
};

export const STYLE_LABEL: Record<PlayStyle, string> = {
  classic: "Classic (2 teams)",
  faceOffLadder: "Face-off ladder (3–8 teams)",
  roundRobin: "Round robin (2–12 teams)",
  allPlay: "All-play (2–50 teams)",
};

export const STYLE_DESCRIPTION: Record<PlayStyle, string> = {
  classic:
    "Face-off, then the winning team plays or passes. The playing team answers until it clears the board or reaches the strike limit; then the other team gets one steal. The winner takes the bank.",
  faceOffLadder:
    "Two teams face off each board (pairs rotate). The playing team answers until it clears the board or strikes out; then every other team gives one steal answer. The highest steal takes the bank.",
  roundRobin:
    "Teams answer one at a time in a rotating order. Each answer found scores for the team that found it.",
  allPlay:
    "Every team answers at the same time each round (captains post in their team chat). Every team that finds a row scores it.",
};

/** The style suggested for a number of teams. */
export function suggestedStyle(teamCount: number): PlayStyle {
  if (teamCount <= 2) return "classic";
  if (teamCount <= 6) return "faceOffLadder";
  return "allPlay";
}

export const DEFAULT_POINTS = [30, 25, 20, 15, 10, 8, 5, 2];

export const LIMITS = {
  minAnswers: 4,
  maxAnswers: 8,
  maxBoards: 30,
  maxPromptLength: 200,
  maxAnswerLength: 80,
  maxAliases: 10,
  maxPoints: 1_000,
  maxMultiplier: 5,
} as const;

/** Drafts may be unfinished: emptiness is reported by preflight, not refused. */
const text = (max: number) => z.string().trim().max(max);
const points = z.number().int().positive().max(LIMITS.maxPoints);

export const answerSchema = z.object({
  id: z.string().min(1).max(64),
  text: text(LIMITS.maxAnswerLength),
  aliases: z.array(text(LIMITS.maxAnswerLength)).max(LIMITS.maxAliases),
  /** Overrides rank points for this row, for example a survey count. */
  points: points.optional(),
});

export const boardSchema = z.object({
  id: z.string().min(1).max(64),
  role: z.enum(["main", "practice", "spare"]),
  prompt: text(LIMITS.maxPromptLength),
  /** Rows in rank order: the first is rank 1. */
  answers: z.array(answerSchema).max(LIMITS.maxAnswers),
  multiplier: z.number().int().min(1).max(LIMITS.maxMultiplier).optional(),
});

export const rulesSchema = z.object({
  playStyle: z.enum(PLAY_STYLES),
  pointValuesByRank: z.array(points).min(1).max(LIMITS.maxAnswers),
  multiplier: z.number().int().min(1).max(LIMITS.maxMultiplier),
  strikes: z.number().int().min(1).max(5),
  turnCycles: z.number().int().min(1).max(4),
  allPlayRounds: z.number().int().min(1).max(8),
  /** "secret" face-offs can't be won on connection speed. */
  faceOffMethod: z.enum(["buzzer", "secret"]),
});

export const contentSchema = z.object({
  rules: rulesSchema,
  boards: z.array(boardSchema).max(LIMITS.maxBoards),
});

export type Answer = z.infer<typeof answerSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Rules = z.infer<typeof rulesSchema>;
export type Content = z.infer<typeof contentSchema>;

export function defaultRules(teamCount: number): Rules {
  return {
    playStyle: suggestedStyle(teamCount),
    pointValuesByRank: [...DEFAULT_POINTS],
    multiplier: 1,
    strikes: 3,
    turnCycles: 2,
    allPlayRounds: 3,
    faceOffMethod: "buzzer",
  };
}

/** Points for the row at `rank` (1-based) on `board`. */
export function pointsFor(rules: Rules, board: Board, rank: number): number {
  const answer = board.answers[rank - 1];
  const base = answer?.points ?? rules.pointValuesByRank[rank - 1] ?? 0;
  return base * (board.multiplier ?? rules.multiplier);
}

export function boardTotal(rules: Rules, board: Board): number {
  return board.answers.reduce(
    (s, _a, i) => s + pointsFor(rules, board, i + 1),
    0,
  );
}

export type Preflight = { blocking: string[]; warnings: string[] };

const decreasing = (w: number[]) => w.every((p, i) => i === 0 || p < w[i - 1]!);

/** What stops a game starting, and what the host should know. */
export function preflight(content: Content, teamCount: number): Preflight {
  const { rules, boards } = content;
  const blocking: string[] = [];
  const warnings: string[] = [];
  const [min, max] = STYLE_TEAM_RANGE[rules.playStyle];
  if (teamCount < min || teamCount > max) {
    blocking.push(
      `${STYLE_LABEL[rules.playStyle]} needs ${min === max ? min : `${min} to ${max}`} teams; this game has ${teamCount}.`,
    );
  }
  if (!decreasing(rules.pointValuesByRank)) {
    blocking.push("Points by rank must go down from rank 1.");
  }
  const main = boards.filter((b) => b.role === "main");
  if (main.length === 0) blocking.push("Add at least one main board.");
  const ids = new Set<string>();
  boards.forEach((board, i) => {
    const name = `Board ${i + 1} ("${board.prompt}")`;
    if (ids.has(board.id)) blocking.push(`${name}: duplicate board ID.`);
    ids.add(board.id);
    const n = board.answers.length;
    if (!board.prompt) blocking.push(`Board ${i + 1}: the prompt is empty.`);
    board.answers.forEach((a, j) => {
      if (!a.text) blocking.push(`${name}: answer ${j + 1} is empty.`);
    });
    if (n < LIMITS.minAnswers) {
      blocking.push(`${name}: needs at least ${LIMITS.minAnswers} answers.`);
    }
    const custom = board.answers.map((a) => a.points);
    const someCustom = custom.some((p) => p !== undefined);
    if (someCustom && custom.some((p) => p === undefined)) {
      blocking.push(`${name}: give every answer points, or none.`);
    } else if (
      someCustom &&
      custom.some((p, j) => j > 0 && p! > custom[j - 1]!)
    ) {
      blocking.push(
        `${name}: an answer can't be worth more than the one above it.`,
      );
    } else if (!someCustom && n > rules.pointValuesByRank.length) {
      blocking.push(
        `${name}: has ${n} answers but points by rank only go to ${rules.pointValuesByRank.length}.`,
      );
    }
    if (new Set(board.answers.map((a) => a.id)).size !== n) {
      blocking.push(`${name}: duplicate answer IDs.`);
    }
    const seen = new Set<string>();
    for (const a of board.answers) {
      for (const t of [a.text, ...a.aliases].filter(Boolean)) {
        const key = t.toLocaleLowerCase();
        if (seen.has(key)) warnings.push(`${name}: "${t}" appears twice.`);
        seen.add(key);
      }
    }
  });
  const totals = new Set(main.map((b) => boardTotal(rules, b)));
  if (totals.size > 1) warnings.push("Main boards are worth different totals.");
  if (rules.playStyle === "roundRobin" && main.length % teamCount !== 0) {
    warnings.push(
      `${main.length} main boards don't give each of ${teamCount} teams the same number of first turns.`,
    );
  }
  if (
    rules.playStyle === "faceOffLadder" &&
    teamCount > 0 &&
    (main.length * 2) % teamCount !== 0
  ) {
    warnings.push(
      `${main.length} main boards don't give each of ${teamCount} teams the same number of face-offs.`,
    );
  }
  if (!boards.some((b) => b.role === "spare")) {
    warnings.push("No spare board for a tie-break.");
  }
  return { blocking, warnings };
}
