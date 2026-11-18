/**
 * A sample pub quiz drawn from the sample holiday grid: the two easiest
 * clues of each category, mixed in category order.
 */
import { sampleBank } from "@/utils/categoryGrid/sample";
import type { Bank } from "@/utils/categoryGrid/content";

export function sampleQuizBank(): Bank {
  const bank = sampleBank();
  const columns = bank.modes.categoryGrid?.columns ?? [];
  const order = [0, 1].flatMap((row) =>
    columns.flatMap((c) => (c.cells[row] ? [c.cells[row].questionId] : [])),
  );
  return {
    ...bank,
    title: "Holiday pub quiz",
    questions: bank.questions.filter((q) => order.includes(q.id)),
    modes: { pubQuiz: { questionOrder: order, pointsPerQuestion: 1 } },
  };
}
