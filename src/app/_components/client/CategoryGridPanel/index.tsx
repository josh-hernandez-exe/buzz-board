"use client";

import { useEffect, useRef, useState } from "react";

import { CategoryGridBoard } from "@/app/_components/client/CategoryGridBoard";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { OtherModeNotice } from "@/app/_components/client/RankedAnswersPanel";
import { QuestionEditor } from "@/app/_components/client/QuestionEditor";
import { Button } from "@/app/_components/ui/button";
import { Notice } from "@/app/_components/ui/page";
import { cn } from "@/app/_lib/utils";
import { helpHref } from "@/help/manifest";
import { api, type RouterOutputs } from "@/trpc/react";
import {
  bankSchema,
  cellKey,
  findCell,
  gridOf,
  gridPreflight,
  GRID_LIMITS,
  resolveGridRules,
  type Bank,
  type Question,
} from "@/utils/categoryGrid/content";
import { sampleBank } from "@/utils/categoryGrid/sample";
import { newRequestId } from "@/utils/requestId";
import { hotkeyHint, useHotkeys } from "@/utils/useHotkeys";

type HostView = RouterOutputs["categoryGrid"]["hostView"];
type Action = Parameters<
  ReturnType<typeof api.categoryGrid.act.useMutation>["mutate"]
>[0]["action"];

const field = "field px-2 py-1 text-sm";

/**
 * The host desk's Category Grid tab: fill in the grid, then run it. Only
 * owners and co-hosts see it, because it shows every answer.
 */
export function CategoryGridPanel() {
  const utils = api.useUtils();
  const query = api.categoryGrid.hostView.useQuery();
  const live = useLiveGameState();
  const modeKey = JSON.stringify(live.data?.mode ?? null);
  // Another host acting changes the public grid: refresh this view.
  useEffect(() => {
    void utils.categoryGrid.hostView.invalidate();
  }, [modeKey, utils]);

  if (query.error) return <ErrorNotice error={query.error} />;
  const view = query.data;
  if (!view) return <p className="text-sm">Loading…</p>;

  return (
    <section
      aria-label="Category Grid"
      className="bg-surface border-border flex w-full flex-col gap-4 rounded-xl border p-4 shadow-sm"
    >
      <p className="text-muted-foreground text-sm">
        <strong>Category Grid</strong>: categories across the top, clues worth
        more as you go down. A team picks a clue, everyone buzzes, and a right
        answer scores and picks next.{" "}
        <a
          className="underline"
          href={helpHref("category-grid")}
          target="_blank"
          rel="noopener"
        >
          How it works
        </a>
      </p>
      {view.otherMode ? (
        <OtherModeNotice mode={view.otherMode} />
      ) : view.status === "none" || view.status === "draft" ? (
        <GridEditor view={view} />
      ) : (
        <GridControls view={view} />
      )}
    </section>
  );
}

// ------------------------------------------------------------- editor

const blankQuestion = (id: string): Question => ({
  id,
  prompt: { text: "" },
  answer: { text: "" },
});

function nextId(bank: Bank, prefix: string) {
  const taken = new Set([
    ...bank.questions.map((q) => q.id),
    ...gridOf(bank).columns.map((c) => c.id),
  ]);
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) return id;
  }
}

function GridEditor({ view }: { view: HostView }) {
  const utils = api.useUtils();
  const [draft, setDraft] = useState<Bank>(view.draft);
  const [revision, setRevision] = useState(view.draftRevision);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  // Pick up another host's save, unless there are unsaved edits here.
  if (!dirty && view.draftRevision !== revision) {
    setDraft(view.draft);
    setRevision(view.draftRevision);
  }

  const refresh = () => {
    void utils.categoryGrid.hostView.invalidate();
    void utils.rankedAnswers.hostView.invalidate();
  };
  const save = api.categoryGrid.saveDraft.useMutation({
    onSuccess: ({ draftRevision }) => {
      setRevision(draftRevision);
      setDirty(false);
      refresh();
    },
  });
  const start = api.categoryGrid.start.useMutation({ onSuccess: refresh });
  const discard = api.categoryGrid.discardDraft.useMutation({
    onSuccess: () => {
      setDirty(false);
      refresh();
    },
  });

  const update = (next: Bank) => {
    setDraft(next);
    setDirty(true);
    save.reset();
  };
  const grid = gridOf(draft);
  const columns = grid.columns;
  const rows = columns[0]?.cells.length ?? 0;
  const rules = resolveGridRules(grid.rules);
  const setGrid = (patch: Partial<Bank["modes"]["categoryGrid"]>) =>
    update({
      ...draft,
      modes: { ...draft.modes, categoryGrid: { ...grid, ...patch } },
    });
  const setQuestion = (id: string, q: Question) =>
    update({
      ...draft,
      questions: draft.questions.map((x) => (x.id === id ? q : x)),
    });

  const addColumn = () => {
    let bank = draft;
    const colId = nextId(bank, "c");
    const cells = Array.from({ length: Math.max(rows, 1) }, (_r, ri) => {
      const qid = nextId(bank, "q");
      bank = { ...bank, questions: [...bank.questions, blankQuestion(qid)] };
      const points = columns[0]?.cells[ri]?.points ?? (ri + 1) * 100;
      return { label: String(points), points, questionId: qid };
    });
    update({
      ...bank,
      modes: {
        ...bank.modes,
        categoryGrid: {
          ...grid,
          columns: [...columns, { id: colId, title: "", cells }],
        },
      },
    });
  };
  const removeColumn = (ci: number) => {
    const removed = new Set(columns[ci]!.cells.map((c) => c.questionId));
    update({
      ...draft,
      questions: draft.questions.filter((q) => !removed.has(q.id)),
      modes: {
        ...draft.modes,
        categoryGrid: { ...grid, columns: columns.filter((_c, i) => i !== ci) },
      },
    });
    setSelected(null);
  };
  const addRow = () => {
    let bank = draft;
    const points = (rows + 1) * 100;
    const next = columns.map((c) => {
      const qid = nextId(bank, "q");
      bank = { ...bank, questions: [...bank.questions, blankQuestion(qid)] };
      return {
        ...c,
        cells: [...c.cells, { label: String(points), points, questionId: qid }],
      };
    });
    update({
      ...bank,
      modes: { ...bank.modes, categoryGrid: { ...grid, columns: next } },
    });
  };
  const removeRow = () => {
    const removed = new Set(columns.map((c) => c.cells.at(-1)!.questionId));
    update({
      ...draft,
      questions: draft.questions.filter((q) => !removed.has(q.id)),
      modes: {
        ...draft.modes,
        categoryGrid: {
          ...grid,
          columns: columns.map((c) => ({ ...c, cells: c.cells.slice(0, -1) })),
        },
      },
    });
    setSelected(null);
  };
  const setRowPoints = (ri: number, points: number) =>
    setGrid({
      columns: columns.map((c) => ({
        ...c,
        cells: c.cells.map((cell, i) =>
          i === ri ? { ...cell, points, label: String(points) } : cell,
        ),
      })),
    });

  const check = gridPreflight(draft, view.teams.length);
  const found = selected ? findCell(draft, selected) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          Grid title
          <input
            className={field}
            value={draft.title}
            maxLength={GRID_LIMITS.maxTitle}
            onChange={(e) => update({ ...draft, title: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 self-end">
          <input
            type="checkbox"
            checked={rules.wrongAnswerLockout}
            onChange={(e) =>
              setGrid({
                rules: { ...grid.rules, wrongAnswerLockout: e.target.checked },
              })
            }
          />
          A wrong answer locks the team out of that clue
        </label>
        <label className="flex flex-col gap-1">
          Wrong answers
          <select
            className={field}
            value={rules.wrongAnswerPenalty}
            onChange={(e) =>
              setGrid({
                rules: {
                  ...grid.rules,
                  wrongAnswerPenalty:
                    e.target.value === "clueValue" ? "clueValue" : "none",
                },
              })
            }
          >
            <option value="none">Lose nothing</option>
            <option value="clueValue">Lose the clue&apos;s value</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="text-muted-foreground w-20 text-left text-xs font-normal">
                Value
              </th>
              {columns.map((c, ci) => (
                <th key={c.id} className="align-top">
                  <input
                    aria-label={`Category ${ci + 1} title`}
                    placeholder={`Category ${ci + 1}`}
                    className={`${field} w-full font-semibold`}
                    value={c.title}
                    maxLength={GRID_LIMITS.maxTitle}
                    onChange={(e) =>
                      setGrid({
                        columns: columns.map((x, i) =>
                          i === ci ? { ...x, title: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  {columns.length > 1 && (
                    <button
                      type="button"
                      className="text-destructive mt-1 text-xs underline"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove "${c.title || `Category ${ci + 1}`}" and its clues?`,
                          )
                        ) {
                          removeColumn(ci);
                        }
                      }}
                    >
                      Remove
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_r, ri) => (
              <tr key={ri}>
                <td>
                  <input
                    type="number"
                    aria-label={`Points for row ${ri + 1}`}
                    className={`${field} w-20`}
                    min={1}
                    max={GRID_LIMITS.maxPoints}
                    value={columns[0]!.cells[ri]!.points}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      if (n >= 1 && n <= GRID_LIMITS.maxPoints) {
                        setRowPoints(ri, n);
                      }
                    }}
                  />
                </td>
                {columns.map((c, ci) => {
                  const key = cellKey(c.id, ri);
                  const q = draft.questions.find(
                    (x) => x.id === c.cells[ri]?.questionId,
                  );
                  const ready = !!q?.prompt.text && !!q.answer.text;
                  return (
                    <td key={key}>
                      <button
                        type="button"
                        data-testid="grid-editor-cell"
                        aria-label={`Edit ${c.title || `category ${ci + 1}`} for ${c.cells[ri]?.label}`}
                        aria-pressed={selected === key}
                        onClick={() => setSelected(key)}
                        className={cn(
                          "border-border flex h-14 w-full flex-col items-start justify-center overflow-hidden rounded-md border px-2 text-left text-xs",
                          selected === key && "border-primary ring-ring ring-2",
                          ready ? "bg-surface-sunken" : "bg-warning-soft",
                        )}
                      >
                        <span className="w-full truncate">
                          {q?.prompt.text.length
                            ? q.prompt.text
                            : "Needs a clue"}
                        </span>
                        <span className="text-muted-foreground w-full truncate">
                          {q?.answer.text ? `→ ${q.answer.text}` : ""}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={columns.length >= GRID_LIMITS.maxColumns}
          onClick={addColumn}
        >
          Add category
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={rows >= GRID_LIMITS.maxRows}
          onClick={addRow}
        >
          Add row
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={rows <= 1}
          onClick={() => {
            if (window.confirm("Remove the bottom row and its clues?")) {
              removeRow();
            }
          }}
        >
          Remove bottom row
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (
              window.confirm("Replace the grid with the sample holiday grid?")
            ) {
              update(sampleBank());
              setSelected(null);
            }
          }}
        >
          Load sample grid
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowJson((s) => !s)}
        >
          {showJson ? "Hide import/export" : "Import or export"}
        </Button>
      </div>

      {found?.question && selected && (
        <QuestionEditor
          key={selected}
          title={`${found.column.title || "This category"} for ${found.cell.label}`}
          question={found.question}
          onChange={(q) => setQuestion(found.question!.id, q)}
          onClose={() => setSelected(null)}
        />
      )}

      {showJson && (
        <BankJson
          bank={draft}
          onImport={(b) => {
            update(b);
            setSelected(null);
          }}
        />
      )}

      {(check.blocking.length > 0 || check.warnings.length > 0) && (
        <div className="flex flex-col gap-2 text-sm">
          {check.blocking.length > 0 && (
            <Notice tone="warning">
              <strong>Fix before starting</strong>
              <ul className="ml-5 list-disc">
                {check.blocking.slice(0, 8).map((p) => (
                  <li key={p}>{p}</li>
                ))}
                {check.blocking.length > 8 && (
                  <li>…and {check.blocking.length - 8} more</li>
                )}
              </ul>
            </Notice>
          )}
          {check.warnings.length > 0 && (
            <Notice tone="info">
              <strong>Worth knowing</strong>
              <ul className="ml-5 list-disc">
                {check.warnings.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ draft, expectedRevision: revision })}
        >
          {save.isPending ? "Saving…" : dirty ? "Save grid" : "Saved"}
        </Button>
        <Button
          className="bg-success text-success-foreground hover:bg-success/90"
          disabled={dirty || check.blocking.length > 0 || start.isPending}
          title={
            dirty
              ? "Save first"
              : check.blocking.length > 0
                ? "Fix the problems listed above first"
                : undefined
          }
          onClick={() => {
            if (
              window.confirm(
                "Start the Category Grid? The clues are locked once it starts.",
              )
            ) {
              start.mutate();
            }
          }}
        >
          Start Category Grid
        </Button>
        {dirty && (
          <span className="text-warning-text text-sm">Unsaved changes</span>
        )}
        {view.status === "draft" && (
          <Button
            variant="ghost"
            className="text-destructive ml-auto"
            disabled={discard.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Discard this Category Grid setup? Its clues are deleted (export them first to keep a copy).",
                )
              ) {
                discard.mutate();
              }
            }}
          >
            Discard setup
          </Button>
        )}
      </div>
      <ErrorNotice error={save.error ?? start.error ?? discard.error} />
    </div>
  );
}

function BankJson({
  bank,
  onImport,
}: {
  bank: Bank;
  onImport: (b: Bank) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(bank, null, 2));
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        The grid as a question bank (Buzz Board question bank format, version
        1). Copy it to keep a backup, or paste one to replace the grid.
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

// ------------------------------------------------------------- controls

function GridControls({ view }: { view: HostView }) {
  const utils = api.useUtils();
  const live = useLiveGameState().data;
  const content = view.content!;
  const state = view.state!;
  const names = Object.fromEntries(view.teams.map((t) => [t.id, t.name]));
  const name = (id: string | null) =>
    id ? (names[id] ?? "A removed team") : "Nobody";
  const refresh = () => utils.categoryGrid.hostView.invalidate();
  // The step this screen last saw: our own actions advance it at once.
  const lastStep = useRef(view.step);
  const step = () => Math.max(view.step, lastStep.current);
  const advanced = ({ step: next }: { step: number }) => {
    lastStep.current = next;
  };
  const act = api.categoryGrid.act.useMutation({
    onSuccess: advanced,
    onSettled: refresh,
  });
  const undo = api.categoryGrid.undo.useMutation({
    onSuccess: advanced,
    onSettled: refresh,
  });
  const end = api.categoryGrid.end.useMutation({ onSettled: refresh });
  const buzzerRefresh = () => utils.gameAdmin.buzzer.history.invalidate();
  const openBuzzer = api.gameAdmin.startBuzzer.useMutation({
    onSuccess: buzzerRefresh,
  });
  const closeBuzzer = api.gameAdmin.pauseBuzzer.useMutation({
    onSuccess: buzzerRefresh,
  });
  const nextQuestion = api.gameAdmin.resetBuzzer.useMutation({
    onSuccess: buzzerRefresh,
  });
  const judgeBuzz = api.gameAdmin.buzzer.judge.useMutation({
    onSuccess: buzzerRefresh,
  });
  const [syncBuzzer, setSyncBuzzer] = useState(true);
  const [chosen, setChosen] = useState<string | null>(null);

  const send = (action: Action, onDone?: () => void) =>
    act.mutate(
      { action, expectedStep: step(), requestId: newRequestId() },
      onDone ? { onSuccess: onDone } : undefined,
    );
  const busy = act.isPending || undo.isPending;
  const running = view.status === "running";
  const clue = state.clue;
  const rules = resolveGridRules(gridOf(content).rules);
  const found = clue ? findCell(content, clue.cell) : null;

  // Whoever holds the buzz now, to pre-fill "who answered".
  const holder =
    live?.game.buzzerMode === "queue"
      ? live.buzzQueue.find((e) => e.status === "answering")?.gameTeamId
      : live?.buzzWinner?.gameTeamId;
  const eligible = view.teams
    .map((t) => t.id)
    .filter((t) => !clue?.lockedOut.includes(t));
  const team =
    chosen && eligible.includes(chosen)
      ? chosen
      : holder && eligible.includes(holder)
        ? holder
        : null;

  /** Marks the buzzer to match the judgement, once it has been recorded. */
  const updateBuzzer = (answered: string, correct: boolean) => {
    if (!syncBuzzer || !live || answered !== holder) return;
    const queue = live.game.buzzerMode === "queue";
    const entry = live.buzzQueue.find(
      (e) => e.status === "answering" && e.gameTeamId === answered,
    );
    if (correct) {
      if (queue && entry) {
        judgeBuzz.mutate({ entryId: entry.id, verdict: "correct" });
      } else if (!queue) {
        nextQuestion.mutate();
      }
    } else if (rules.wrongAnswerLockout) {
      if (queue && entry) {
        judgeBuzz.mutate({ entryId: entry.id, verdict: "wrong" });
      } else if (!queue) {
        openBuzzer.mutate();
      }
    } else if (queue && entry) {
      judgeBuzz.mutate({ entryId: entry.id, verdict: "skip" });
    } else if (!queue) {
      nextQuestion.mutate(undefined, { onSuccess: () => openBuzzer.mutate() });
    }
  };

  const judge = (correct: boolean) => {
    if (!team) return;
    const answered = team;
    send({ type: "judge", team: answered, correct }, () => {
      setChosen(null);
      updateBuzzer(answered, correct);
    });
  };
  const revealAnswer = () =>
    send({ type: "revealAnswer" }, () => {
      if (syncBuzzer) closeBuzzer.mutate();
    });
  const clueOpen = running && clue?.phase === "open";
  useHotkeys(
    {
      c: clueOpen && team ? () => judge(true) : undefined,
      w: clueOpen && team ? () => judge(false) : undefined,
      r: clueOpen ? revealAnswer : undefined,
      b:
        running && clue?.phase === "answered"
          ? () => send({ type: "closeClue" })
          : undefined,
    },
    !busy,
  );

  return (
    <div className="flex flex-col gap-4">
      {view.view && (
        <CategoryGridBoard
          view={view.view}
          names={names}
          hostAnswer={found?.question?.answer.text}
          onPick={
            running && !state.finished && !clue && !busy
              ? (cell) =>
                  send({ type: "openClue", cell }, () => {
                    setChosen(null);
                    // A fresh clue: everyone can buzz again.
                    if (syncBuzzer) nextQuestion.mutate();
                  })
              : undefined
          }
        />
      )}

      {running && !state.finished && (
        <div data-testid="grid-controls" className="flex flex-col gap-3">
          {!clue && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                Picks next
                <select
                  aria-label="Team that picks next"
                  className={field}
                  value={state.selector ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    send({ type: "setSelector", team: e.target.value || null })
                  }
                >
                  <option value="">Nobody (host picks)</option>
                  {view.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-muted-foreground">
                Tap a clue on the grid to open it.
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Finish the Category Grid?")) {
                    send({ type: "finish" });
                  }
                }}
              >
                Finish grid
              </Button>
            </div>
          )}

          {clue && found?.question && (
            <div className="flex flex-col gap-3">
              <div className="bg-surface-sunken flex flex-col gap-1 rounded-lg p-3 text-sm">
                <p>
                  <strong>Answer:</strong> {found.question.answer.text}
                  {found.question.answer.acceptedAnswers?.length
                    ? ` (also accept: ${found.question.answer.acceptedAnswers.join(", ")})`
                    : ""}
                </p>
                {found.question.hostNotes && (
                  <p className="text-muted-foreground">
                    <strong>Notes:</strong> {found.question.hostNotes}
                  </p>
                )}
              </div>

              {clue.phase === "open" ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Team answering"
                      className={field}
                      value={team ?? ""}
                      onChange={(e) => setChosen(e.target.value || null)}
                    >
                      <option value="">Who answered?</option>
                      {eligible.map((t) => (
                        <option key={t} value={t}>
                          {name(t)}
                          {t === holder ? " (holds the buzz)" : ""}
                        </option>
                      ))}
                    </select>
                    {live && !live.game.isBuzzerListening && (
                      <Button
                        variant="secondary"
                        disabled={openBuzzer.isPending}
                        onClick={() => openBuzzer.mutate()}
                      >
                        Open buzzer
                      </Button>
                    )}
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={syncBuzzer}
                        onChange={(e) => setSyncBuzzer(e.target.checked)}
                      />
                      Also update the buzzer
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="bg-success text-success-foreground hover:bg-success/90"
                      disabled={busy || !team}
                      aria-keyshortcuts="C"
                      onClick={() => judge(true)}
                    >
                      ✓ Correct
                      {team ? `: ${name(team)} +${found.cell.points}` : ""}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy || !team}
                      aria-keyshortcuts="W"
                      onClick={() => judge(false)}
                    >
                      ✕ Wrong
                      {team
                        ? `: ${name(team)}${rules.wrongAnswerPenalty === "clueValue" ? ` −${found.cell.points}` : ""}`
                        : ""}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      aria-keyshortcuts="R"
                      onClick={revealAnswer}
                    >
                      Nobody got it: show the answer
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    aria-keyshortcuts="B"
                    onClick={() => send({ type: "closeClue" })}
                  >
                    Back to the grid
                  </Button>
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                Keyboard:{" "}
                {hotkeyHint([
                  ["C", "correct"],
                  ["W", "wrong"],
                  ["R", "show the answer"],
                  ["B", "back to the grid"],
                ])}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive self-start"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Void this clue? Its points are taken back, the pick goes back, and the clue can't be played again.",
                    )
                  ) {
                    send({ type: "voidClue" }, () => {
                      if (syncBuzzer) closeBuzzer.mutate();
                    });
                  }
                }}
              >
                Void this clue
              </Button>
            </div>
          )}
        </div>
      )}

      <ErrorNotice
        error={
          act.error ??
          undo.error ??
          end.error ??
          openBuzzer.error ??
          nextQuestion.error ??
          judgeBuzz.error
        }
      />

      {running && (
        <div className="border-border flex flex-wrap gap-2 border-t pt-3">
          <Button
            variant="secondary"
            disabled={!view.canUndo || busy}
            onClick={() =>
              undo.mutate({ expectedStep: step(), requestId: newRequestId() })
            }
          >
            Undo last action
          </Button>
          <Button
            variant="destructive"
            disabled={end.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Stop the Category Grid and use basic controls? Scores, players and chat stay. You can't come back to this grid in this room.",
                )
              ) {
                end.mutate();
              }
            }}
          >
            Use basic controls
          </Button>
        </div>
      )}
      {running && (
        <p className="text-muted-foreground text-xs">
          Undo takes back the points of the last action. A clue that was shown
          can&apos;t be played again, and a shown answer stays shown.
        </p>
      )}
      {view.status === "ended" && (
        <p className="text-sm">
          The Category Grid has ended. Use the Play tab for buzzers and scores.
        </p>
      )}
    </div>
  );
}
