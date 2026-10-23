"use client";

import { useState } from "react";

import { QuestionEditor } from "@/app/_components/client/QuestionEditor";
import { Button } from "@/app/_components/ui/button";
import { cn } from "@/app/_lib/utils";
import { GRID_LIMITS, type Bank } from "@/utils/categoryGrid/content";
import {
  addQuestion,
  deleteQuestion,
  describeUse,
  duplicateQuestion,
  matchesSearch,
  questionUses,
} from "@/utils/questionBank/library";

const PAGE = 50;
type Filter = "all" | "unused" | "used";

/**
 * Every question in the bank, searchable, with where each one is used.
 * Editing a question here changes it everywhere it's used. A question in
 * use can't be deleted; remove its uses first. `pick` adds a
 * context action, such as "Use for this tile" or "Add to quiz".
 */
export function QuestionLibrary({
  bank,
  onChange,
  pick,
}: {
  bank: Bank;
  onChange: (bank: Bank) => void;
  pick?: {
    label: string;
    onPick: (id: string) => void;
    /** Why a question can't be picked, or null. */
    blocked?: (id: string) => string | null;
  };
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const uses = questionUses(bank);
  const matching = bank.questions.filter((q) => {
    const used = (uses.get(q.id)?.length ?? 0) > 0;
    if (filter === "unused" && used) return false;
    if (filter === "used" && !used) return false;
    return matchesSearch(q, search);
  });
  const unusedCount = bank.questions.filter((q) => !uses.get(q.id)).length;
  const full = bank.questions.length >= GRID_LIMITS.maxQuestions;
  const fullMessage = `The bank is full (${GRID_LIMITS.maxQuestions} questions).`;

  const add = () => {
    addQuestion(bank).match(
      ({ bank: next, id }) => {
        onChange(next);
        setEditing(id);
        setFilter("all");
        setSearch("");
        setProblem(null);
      },
      () => setProblem(fullMessage),
    );
  };

  return (
    <section
      aria-label="Question library"
      data-testid="question-library"
      className="border-border flex flex-col gap-3 rounded-lg border p-3 text-sm"
    >
      <div className="flex flex-wrap items-end gap-2">
        <h3 className="mr-auto font-semibold">
          Question library ({bank.questions.length}
          {unusedCount > 0 ? `, ${unusedCount} unused` : ""})
        </h3>
        <input
          type="search"
          aria-label="Search questions"
          className="field px-2 py-1"
          placeholder="Search questions"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShown(PAGE);
          }}
        />
        <select
          aria-label="Show"
          className="field px-2 py-1"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setShown(PAGE);
          }}
        >
          <option value="all">All questions</option>
          <option value="unused">Unused</option>
          <option value="used">In use</option>
        </select>
        <Button size="sm" variant="secondary" disabled={full} onClick={add}>
          New question
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        One pool of questions for this game&apos;s grid and quiz. Editing a
        question changes it everywhere it&apos;s used. Removing a tile or quiz
        position keeps what you wrote here.
      </p>

      {matching.length === 0 ? (
        <p className="text-muted-foreground">
          {bank.questions.length === 0
            ? "No questions yet."
            : "No questions match."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {matching.slice(0, shown).map((q) => {
            const qUses = uses.get(q.id) ?? [];
            const media =
              (q.prompt.media?.length ?? 0) + (q.answer.media?.length ?? 0);
            const why = pick?.blocked?.(q.id) ?? null;
            const open = editing === q.id;
            const name = q.prompt.text || q.id;
            return (
              <li
                key={q.id}
                data-testid="library-question"
                className={cn(
                  "border-border flex flex-col gap-2 rounded-md border px-2 py-1.5",
                  open && "border-primary ring-ring ring-2",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                    aria-expanded={open}
                    aria-label={`Edit question: ${name}`}
                    onClick={() => setEditing(open ? null : q.id)}
                  >
                    <span className="w-full truncate">
                      {q.prompt.text || (
                        <span className="text-muted-foreground italic">
                          No clue yet
                        </span>
                      )}
                      {media > 0 && (
                        <span
                          className="text-muted-foreground ml-1 text-xs"
                          title={`${media} media item${media === 1 ? "" : "s"}`}
                        >
                          ▣ {media}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground w-full truncate text-xs">
                      {q.answer.text ? `→ ${q.answer.text}` : "No answer yet"}
                    </span>
                  </button>
                  {pick && (
                    <Button
                      size="sm"
                      disabled={!!why}
                      title={why ?? undefined}
                      aria-label={`${pick.label}: ${name}`}
                      onClick={() => pick.onPick(q.id)}
                    >
                      {pick.label}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Duplicate ${name}`}
                    disabled={full}
                    onClick={() =>
                      duplicateQuestion(bank, q.id).match(
                        ({ bank: next, id }) => {
                          onChange(next);
                          setEditing(id);
                        },
                        () => setProblem(fullMessage),
                      )
                    }
                  >
                    Duplicate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={`Delete ${name}`}
                    disabled={qUses.length > 0}
                    title={
                      qUses.length > 0
                        ? "In use: remove it from the grid or quiz first"
                        : undefined
                    }
                    onClick={() => {
                      if (
                        window.confirm(`Delete "${name}" from the library?`)
                      ) {
                        deleteQuestion(bank, q.id).match(
                          (next) => {
                            onChange(next);
                            if (open) setEditing(null);
                          },
                          () =>
                            setProblem(
                              "That question is in use: remove it from the grid or quiz first.",
                            ),
                        );
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {qUses.length === 0 ? (
                    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                      Unused
                    </span>
                  ) : (
                    qUses.map((u, i) => (
                      <span
                        key={i}
                        data-testid="library-use"
                        className="bg-accent text-accent-foreground rounded-full px-2 py-0.5 text-xs"
                      >
                        {describeUse(u)}
                      </span>
                    ))
                  )}
                  <span className="text-muted-foreground ml-auto font-mono text-xs">
                    {q.id}
                  </span>
                </div>
                {open && (
                  <QuestionEditor
                    key={q.id}
                    title={
                      qUses.length > 1
                        ? `Used ${qUses.length} times: edits change every use`
                        : "Question"
                    }
                    question={q}
                    onChange={(next) =>
                      onChange({
                        ...bank,
                        questions: bank.questions.map((x) =>
                          x.id === q.id ? next : x,
                        ),
                      })
                    }
                    onClose={() => setEditing(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {matching.length > shown && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show more ({matching.length - shown} left)
        </Button>
      )}
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}
