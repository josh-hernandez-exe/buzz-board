/**
 * Category Grid content: a question bank and a grid that places questions
 * in columns (categories) and rows (values). The document shape follows the
 * plan's Shared JSON Question Bank v1 (text only for now: no media), so a
 * bank exported here can be imported elsewhere. Pure and browser-safe.
 */
import { z } from "zod";

export const GRID_LIMITS = {
  maxColumns: 8,
  maxRows: 10,
  maxQuestions: 200,
  maxText: 4_000,
  maxTitle: 80,
  maxAccepted: 20,
  maxAcceptedLength: 200,
  maxPoints: 1_000_000,
} as const;

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "IDs use letters, digits, . _ -");
/** Drafts may be unfinished: emptiness is reported by preflight. */
const text = (max: number) => z.string().trim().max(max);

export const questionSchema = z
  .object({
    id: idSchema,
    prompt: z.object({ text: text(GRID_LIMITS.maxText) }).strict(),
    answer: z
      .object({
        text: text(GRID_LIMITS.maxText),
        acceptedAnswers: z
          .array(text(GRID_LIMITS.maxAcceptedLength))
          .max(GRID_LIMITS.maxAccepted)
          .optional(),
      })
      .strict(),
    /** Private to hosts. */
    hostNotes: text(GRID_LIMITS.maxText).optional(),
  })
  .strict();

export const cellSchema = z
  .object({
    label: text(GRID_LIMITS.maxTitle),
    points: z.number().int().positive().max(GRID_LIMITS.maxPoints),
    questionId: idSchema,
  })
  .strict();

export const columnSchema = z
  .object({
    id: idSchema,
    title: text(GRID_LIMITS.maxTitle),
    cells: z.array(cellSchema).min(1).max(GRID_LIMITS.maxRows),
  })
  .strict();

export const gridRulesSchema = z
  .object({
    /** A team that answers wrongly can't answer that clue again. */
    wrongAnswerLockout: z.boolean().optional(),
    /** "clueValue": a wrong answer loses the clue's points. */
    wrongAnswerPenalty: z.enum(["none", "clueValue"]).optional(),
  })
  .strict();

export const bankSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(1),
    kind: z.literal("questionBank"),
    title: text(GRID_LIMITS.maxTitle),
    questions: z.array(questionSchema).max(GRID_LIMITS.maxQuestions),
    modes: z
      .object({
        categoryGrid: z
          .object({
            columns: z.array(columnSchema).min(1).max(GRID_LIMITS.maxColumns),
            rules: gridRulesSchema.optional(),
          })
          .strict(),
        // Other layouts (for example a quiz order) are kept as they are.
        pubQuiz: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();

export type Question = z.infer<typeof questionSchema>;
export type Cell = z.infer<typeof cellSchema>;
export type Column = z.infer<typeof columnSchema>;
export type GridRules = z.infer<typeof gridRulesSchema>;
export type Bank = z.infer<typeof bankSchema>;

export type ResolvedGridRules = {
  wrongAnswerLockout: boolean;
  wrongAnswerPenalty: "none" | "clueValue";
};

export function resolveGridRules(
  rules: GridRules | undefined,
): ResolvedGridRules {
  return {
    wrongAnswerLockout: rules?.wrongAnswerLockout ?? true,
    wrongAnswerPenalty: rules?.wrongAnswerPenalty ?? "none",
  };
}

/** A cell's address: column ID and row (0-based), e.g. "music:2". */
export const cellKey = (columnId: string, row: number) => `${columnId}:${row}`;

export function findCell(bank: Bank, key: string) {
  const at = key.lastIndexOf(":");
  const columnId = key.slice(0, at);
  const row = Number(key.slice(at + 1));
  const column = bank.modes.categoryGrid.columns.find((c) => c.id === columnId);
  const cell = Number.isInteger(row) ? column?.cells[row] : undefined;
  if (!column || !cell) return null;
  const question = bank.questions.find((q) => q.id === cell.questionId);
  return { column, cell, row, question };
}

export function allCellKeys(bank: Bank): string[] {
  return bank.modes.categoryGrid.columns.flatMap((c) =>
    c.cells.map((_cell, row) => cellKey(c.id, row)),
  );
}

/** An empty grid: `columns` × `rows`, values 100, 200, … */
export function emptyBank(columns = 5, rows = 5): Bank {
  const questions: Question[] = [];
  const cols: Column[] = Array.from({ length: columns }, (_c, ci) => ({
    id: `c${ci + 1}`,
    title: "",
    cells: Array.from({ length: rows }, (_r, ri) => {
      const id = `q${ci + 1}-${ri + 1}`;
      questions.push({ id, prompt: { text: "" }, answer: { text: "" } });
      return {
        label: String((ri + 1) * 100),
        points: (ri + 1) * 100,
        questionId: id,
      };
    }),
  }));
  return {
    schemaVersion: 1,
    kind: "questionBank",
    title: "Category Grid",
    questions,
    modes: { categoryGrid: { columns: cols } },
  };
}

export type GridPreflight = { blocking: string[]; warnings: string[] };

/** What stops a grid starting, and what the host should know. */
export function gridPreflight(bank: Bank, teamCount: number): GridPreflight {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const { columns } = bank.modes.categoryGrid;
  if (teamCount < 1) blocking.push("Add at least one team or player.");
  const rows = columns[0]?.cells.length ?? 0;
  if (columns.some((c) => c.cells.length !== rows)) {
    blocking.push("Every category needs the same number of clues.");
  }
  const columnIds = new Set<string>();
  const used = new Set<string>();
  const questions = new Map(bank.questions.map((q) => [q.id, q]));
  if (questions.size !== bank.questions.length) {
    blocking.push("Two questions share an ID.");
  }
  columns.forEach((column, ci) => {
    const name = column.title || `Category ${ci + 1}`;
    if (!column.title) blocking.push(`Category ${ci + 1} needs a title.`);
    if (columnIds.has(column.id))
      blocking.push(`${name}: duplicate category ID.`);
    columnIds.add(column.id);
    column.cells.forEach((cell, ri) => {
      const where = `${name}, ${cell.label || `row ${ri + 1}`}`;
      if (!cell.label) blocking.push(`${where}: the tile needs a label.`);
      const q = questions.get(cell.questionId);
      if (!q) {
        blocking.push(`${where}: question "${cell.questionId}" doesn't exist.`);
        return;
      }
      if (used.has(cell.questionId)) {
        blocking.push(`${where}: question "${cell.questionId}" is used twice.`);
      }
      used.add(cell.questionId);
      if (!q.prompt.text) blocking.push(`${where}: the clue is empty.`);
      if (!q.answer.text) blocking.push(`${where}: the answer is empty.`);
    });
  });
  const unused = bank.questions.filter((q) => !used.has(q.id)).length;
  if (unused > 0) {
    warnings.push(
      `${unused} question${unused === 1 ? " isn't" : "s aren't"} on the grid (kept for later).`,
    );
  }
  return { blocking, warnings };
}
