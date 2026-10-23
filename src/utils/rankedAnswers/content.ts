/**
 * Ranked Answers content and rules: shared by the server (validation, the
 * engine) and the host's editor. Pure and browser-safe.
 */
import { z } from "zod";

/**
 * Every style is for several teams at once: Buzz Board is for groups, so
 * there's no two-team-only style. The classic TV format lives on as
 * "Classic feud" (`faceOffLadder`): rotating face-offs for 3–8 teams.
 */
export const PLAY_STYLES = [
  "open",
  "faceOffLadder",
  "roundRobin",
  "passAlong",
  "buzzRace",
  "allPlay",
] as const;
export type PlayStyle = (typeof PLAY_STYLES)[number];

/** Team counts each style supports. */
export const STYLE_TEAM_RANGE: Record<PlayStyle, [number, number]> = {
  open: [2, 50],
  faceOffLadder: [3, 8],
  roundRobin: [2, 12],
  passAlong: [2, 12],
  buzzRace: [2, 50],
  allPlay: [2, 50],
};

export const STYLE_LABEL: Record<PlayStyle, string> = {
  open: "Open answering (2–50 teams)",
  faceOffLadder: "Classic feud (3–8 teams)",
  roundRobin: "Round robin (2–12 teams)",
  passAlong: "Pass-along (2–12 teams)",
  buzzRace: "Buzz race (2–50 teams)",
  allPlay: "All-play (2–50 teams)",
};

export const STYLE_DESCRIPTION: Record<PlayStyle, string> = {
  open: "No turns: any team can answer at any time. The host reveals each answer and credits every team that got it.",
  faceOffLadder:
    "The TV format for a crowd: two teams face off each board (pairs rotate so every team gets its turns). The winner plays or passes; the playing team answers until it clears the board or strikes out; then every other team gives one steal answer. The highest steal takes the bank.",
  roundRobin:
    "Teams answer one at a time in a rotating order. Each answer found scores for the team that found it.",
  passAlong:
    "A team keeps answering until it misses; then the next team in order takes over. Each answer found scores for the team that found it.",
  buzzRace:
    "Every answer is a race: teams buzz in, the first answers. A right answer scores for that team; a wrong one locks the team out (until the next answer is found, or after a number of misses).",
  allPlay:
    "Every team answers at the same time each round (captains post in their team chat). Every team that finds a row scores it.",
};

/** The style suggested for a number of teams. */
export function suggestedStyle(_teamCount: number): PlayStyle {
  return "open";
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
  // Drafts and games saved before the two-team "classic" style was retired
  // load as the classic feud ladder: the engine plays them the same way.
  playStyle: z.preprocess(
    (v) => (v === "classic" ? "faceOffLadder" : v),
    z.enum(PLAY_STYLES),
  ),
  pointValuesByRank: z.array(points).min(1).max(LIMITS.maxAnswers),
  multiplier: z.number().int().min(1).max(LIMITS.maxMultiplier),
  strikes: z.number().int().min(1).max(5),
  turnCycles: z.number().int().min(1).max(4),
  allPlayRounds: z.number().int().min(1).max(8),
  /**
   * "secret" face-offs can't be won on connection speed. "none" skips the
   * face-off: the playing team takes turns by rotation.
   */
  faceOffMethod: z.enum(["buzzer", "secret", "none"]),
  // Added later: optional, so drafts saved before them still load. Read
  // them through `resolveRules`, which fills in each style's default.
  /** Face-off winner may pass the board to the other team. */
  allowPass: z.boolean().optional(),
  /** Who may steal after the strikes: the face-off opponent, every other team, or nobody. */
  stealBy: z.enum(["opponent", "everyone", "none"]).optional(),
  /** Several teams steal: the best (highest) row takes the bank, or every correct stealer does. */
  stealWinner: z.enum(["bestRow", "allCorrect"]).optional(),
  /** A successful steal takes the bank plus the row, or only the row (the playing team keeps the bank). */
  stealReward: z.enum(["bankPlusRow", "rowOnly"]).optional(),
  /** Face-off styles: rows build a bank paid at the end, or score straight away for whoever found them. */
  scoring: z.enum(["bank", "direct"]).optional(),
  /** All-play: when several teams find the same row, each gets it all, they split it, or nobody scores it. */
  sharedAnswers: z.enum(["full", "split", "uniqueOnly"]).optional(),
  /** Buzz race: after a wrong answer, a team waits for the next row to be found, sits out after `strikes` misses, or isn't locked out. */
  raceLockout: z.enum(["untilNextFind", "afterStrikes", "none"]).optional(),
  /** Points taken off a team for a miss when it alone was answering (0 = none). */
  missPenalty: z.number().int().min(0).max(LIMITS.maxPoints).optional(),
  /** Shown to everyone: the first team to reach it wins. Informational; the host still finishes. */
  targetScore: z.number().int().positive().max(1_000_000).nullable().optional(),
});

export const contentSchema = z.object({
  rules: rulesSchema,
  boards: z.array(boardSchema).max(LIMITS.maxBoards),
});

export type Answer = z.infer<typeof answerSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Rules = z.infer<typeof rulesSchema>;
export type ResolvedRules = Required<Omit<Rules, "targetScore">> & {
  targetScore: number | null;
};

/** Styles where two teams face off and one plays the board. */
export const isFaceOffStyle = (style: PlayStyle) => style === "faceOffLadder";

/** Rules with every option filled in: the style's default where unset. */
export function resolveRules(rules: Rules): ResolvedRules {
  return {
    ...rules,
    allowPass: rules.allowPass ?? true,
    stealBy: rules.stealBy ?? "everyone",
    stealWinner: rules.stealWinner ?? "bestRow",
    stealReward: rules.stealReward ?? "bankPlusRow",
    scoring: rules.scoring ?? "bank",
    sharedAnswers: rules.sharedAnswers ?? "full",
    raceLockout: rules.raceLockout ?? "untilNextFind",
    missPenalty: rules.missPenalty ?? 0,
    targetScore: rules.targetScore ?? null,
  };
}

/** Which options matter for a style, so editors only show those. */
export function optionsFor(rules: Rules) {
  const style = rules.playStyle;
  const faceOff = isFaceOffStyle(style);
  const r = resolveRules(rules);
  return {
    strikes:
      faceOff || (style === "buzzRace" && r.raceLockout === "afterStrikes"),
    faceOffMethod: faceOff,
    allowPass: faceOff && r.faceOffMethod !== "none",
    scoring: faceOff,
    stealBy: faceOff,
    stealWinner: faceOff && r.stealBy === "everyone",
    stealReward: faceOff && r.stealBy !== "none" && r.scoring === "bank",
    turnCycles: style === "roundRobin" || style === "passAlong",
    allPlayRounds: style === "allPlay",
    sharedAnswers: style === "allPlay" || style === "open",
    raceLockout: style === "buzzRace",
    missPenalty: style !== "allPlay",
  };
}
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

export type PresetId =
  | "open"
  | "classic"
  | "noFaceOff"
  | "headToHead"
  | "roundRobin"
  | "passAlong"
  | "buzzRace"
  | "allPlay"
  | "uniqueAnswers";

export type Preset = {
  id: PresetId;
  label: string;
  teams: [number, number];
  summary: string;
  rules: Partial<Rules> & { playStyle: PlayStyle };
};

/**
 * Named starting points. Each is just a set of rule options: everything
 * stays editable afterwards.
 */
export const PRESETS: Preset[] = [
  {
    id: "open",
    label: "Open answering",
    teams: [2, 50],
    summary:
      "Trivia style: anyone can answer at any time, no turns. Reveal each answer and credit every team that got it.",
    rules: { playStyle: "open", sharedAnswers: "full" },
  },
  {
    id: "classic",
    label: "Classic feud",
    teams: [3, 8],
    summary:
      "The TV format, for 3 or more teams: two teams face off each board (pairs rotate), play or pass, three strikes, then every other team steals for the bank.",
    rules: {
      playStyle: "faceOffLadder",
      faceOffMethod: "buzzer",
      stealBy: "everyone",
    },
  },
  {
    id: "headToHead",
    label: "Classic feud, head-to-head",
    teams: [3, 8],
    summary:
      "As Classic feud, but only the face-off opponent can steal: each board is a two-team match.",
    rules: { playStyle: "faceOffLadder", stealBy: "opponent" },
  },
  {
    id: "noFaceOff",
    label: "Take turns, no face-off",
    teams: [3, 8],
    summary:
      "Teams take turns playing whole boards in rotation: three strikes, then every other team steals.",
    rules: {
      playStyle: "faceOffLadder",
      faceOffMethod: "none",
      stealBy: "everyone",
    },
  },
  {
    id: "roundRobin",
    label: "Round robin",
    teams: [2, 12],
    summary: "One answer per team in turn. Calm and simple; every find scores.",
    rules: { playStyle: "roundRobin" },
  },
  {
    id: "passAlong",
    label: "Pass-along",
    teams: [2, 12],
    summary:
      "Keep answering until you miss, then the next team takes over. Every find scores.",
    rules: { playStyle: "passAlong" },
  },
  {
    id: "buzzRace",
    label: "Buzz race",
    teams: [2, 50],
    summary:
      "Every answer is a buzzer race. Wrong answers sit out until the next answer is found. Best with queued buzzing.",
    rules: { playStyle: "buzzRace", raceLockout: "untilNextFind" },
  },
  {
    id: "allPlay",
    label: "All-play",
    teams: [2, 50],
    summary:
      "Every team answers secretly each round; every team that finds a row scores it.",
    rules: { playStyle: "allPlay", sharedAnswers: "full" },
  },
  {
    id: "uniqueAnswers",
    label: "All-play, unique answers only",
    teams: [2, 50],
    summary:
      "Everyone answers each round, but a row only scores if exactly one team found it. Rewards thinking differently.",
    rules: { playStyle: "allPlay", sharedAnswers: "uniqueOnly" },
  },
];

/** The rules for a preset, starting from the defaults. */
export function presetRules(id: PresetId, teamCount: number): Rules {
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
  return { ...defaultRules(teamCount), ...preset.rules };
}

/** The preset suggested for a number of teams. */
export function suggestedPreset(_teamCount: number): PresetId {
  return "open";
}

/** Points for the row at `rank` (1-based) on `board`. */
export function pointsFor(
  rules: Pick<Rules, "pointValuesByRank" | "multiplier">,
  board: Board,
  rank: number,
): number {
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
