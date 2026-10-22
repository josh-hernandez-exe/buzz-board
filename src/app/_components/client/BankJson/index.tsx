"use client";

import { useState } from "react";

import { Button } from "@/app/_components/ui/button";
import { bankSchema, type Bank } from "@/utils/categoryGrid/content";

const field = "field px-2 py-1 text-sm";

/**
 * Import or export a question bank as JSON (Buzz Board question bank
 * format, version 1). One bank can hold a grid and a quiz.
 */
export function BankJson({
  bank,
  description,
  onImport,
}: {
  bank: Bank;
  description: string;
  onImport: (b: Bank) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(bank, null, 2));
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        {description} (Buzz Board question bank format, version 1.)
      </p>
      <textarea
        aria-label="Question bank JSON"
        className={`${field} min-h-48 font-mono text-xs`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            let raw: unknown;
            try {
              raw = JSON.parse(text);
            } catch {
              setProblem("That isn't valid JSON.");
              return;
            }
            const parsed = bankSchema.safeParse(raw);
            if (!parsed.success) {
              setProblem(
                parsed.error.issues
                  .slice(0, 5)
                  .map((i) => `${i.path.join(".") || "file"}: ${i.message}`)
                  .join("; "),
              );
              return;
            }
            setProblem(null);
            onImport(parsed.data);
          }}
        >
          Import
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
