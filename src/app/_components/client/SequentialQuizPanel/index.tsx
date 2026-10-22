"use client";

import { useEffect, useRef, useState } from "react";

import { BankJson } from "@/app/_components/client/BankJson";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { QuestionEditor } from "@/app/_components/client/QuestionEditor";
import { OtherModeNotice } from "@/app/_components/client/RankedAnswersPanel";
import { SequentialQuizBoard } from "@/app/_components/client/SequentialQuizBoard";
import { Button } from "@/app/_components/ui/button";
import { Notice, StatusPill } from "@/app/_components/ui/page";
import { cn } from "@/app/_lib/utils";
import { helpHref } from "@/help/manifest";
import { api, type RouterOutputs } from "@/trpc/react";
import {
  GRID_LIMITS,
  type Bank,
  type Question,
} from "@/utils/categoryGrid/content";
import {
  normalizeAnswer,
  quizPreflight,
  QUIZ_LIMITS,
} from "@/utils/sequentialQuiz/content";
import { quizOrder, quizPoints } from "@/utils/sequentialQuiz/engine";
import { sampleQuizBank } from "@/utils/sequentialQuiz/sample";
import { newRequestId } from "@/utils/requestId";
import { hotkeyHint, useHotkeys } from "@/utils/useHotkeys";

type HostView = RouterOutputs["sequentialQuiz"]["hostView"];
type Response =
  RouterOutputs["sequentialQuiz"]["responses"]["responses"][number];
type Action = Parameters<
  ReturnType<typeof api.sequentialQuiz.act.useMutation>["mutate"]
>[0]["action"];

const field = "field px-2 py-1 text-sm";

/**
 * The host desk's Quiz tab: write the questions in order, then run them.
 * Only owners and co-hosts see it, because it shows answers.
 */
export function SequentialQuizPanel() {
  const utils = api.useUtils();
  const query = api.sequentialQuiz.hostView.useQuery();
  const live = useLiveGameState();
  const modeKey = JSON.stringify(live.data?.mode ?? null);
  // Another host acting, or a team answering: refresh this view.
  useEffect(() => {
    void utils.sequentialQuiz.hostView.invalidate();
  }, [modeKey, utils]);

  if (query.error) return <ErrorNotice error={query.error} />;
  const view = query.data;
  if (!view) return <p className="text-sm">Loading…</p>;

  return (
    <section
      aria-label="Sequential Quiz"
      className="bg-surface border-border flex w-full flex-col gap-4 rounded-xl border p-4 shadow-sm"
    >
      <p className="text-muted-foreground text-sm">
        <strong>Sequential Quiz</strong>: questions one at a time, in order.
        Every team types an answer on a phone; you mark them, then reveal the
        answer and the points together.{" "}
        <a
          className="underline"
          href={helpHref("sequential-quiz")}
          target="_blank"
          rel="noopener"
        >
          How it works
        </a>
      </p>
      {view.otherMode ? (
        <OtherModeNotice mode={view.otherMode} />
      ) : view.status === "none" || view.status === "draft" ? (
        <QuizEditor view={view} />
      ) : (
        <QuizControls view={view} />
      )}
    </section>
  );
}

// ------------------------------------------------------------- editor

function nextQuestionId(bank: Bank) {
  const taken = new Set(bank.questions.map((q) => q.id));
  for (let n = 1; ; n++) {
    const id = `q${n}`;
    if (!taken.has(id)) return id;
  }
}

function QuizEditor({ view }: { view: HostView }) {
  const utils = api.useUtils();
  const [draft, setDraft] = useState<Bank>(view.draft);
  const [revision, setRevision] = useState(view.draftRevision);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [showJson, setShowJson] = useState(false);

  // Pick up another host's save, unless there are unsaved edits here.
  if (!dirty && view.draftRevision !== revision) {
    setDraft(view.draft);
    setRevision(view.draftRevision);
  }

  const refresh = () => {
    void utils.sequentialQuiz.hostView.invalidate();
    void utils.categoryGrid.hostView.invalidate();
    void utils.rankedAnswers.hostView.invalidate();
  };
  const save = api.sequentialQuiz.saveDraft.useMutation({
    onSuccess: ({ draftRevision }) => {
      setRevision(draftRevision);
      setDirty(false);
      refresh();
    },
  });
  const start = api.sequentialQuiz.start.useMutation({ onSuccess: refresh });
  const discard = api.sequentialQuiz.discardDraft.useMutation({
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
  const order = quizOrder(draft);
  const points = quizPoints(draft);
  const setQuiz = (patch: {
    questionOrder?: string[];
    pointsPerQuestion?: number;
  }) =>
    update({
      ...draft,
      modes: {
        ...draft.modes,
        pubQuiz: {
          questionOrder: order,
          pointsPerQuestion: points,
          ...patch,
        },
      },
    });
  const byId = new Map(draft.questions.map((q) => [q.id, q]));
  const unused = draft.questions.filter((q) => !order.includes(q.id));

  const addQuestion = () => {
    const id = nextQuestionId(draft);
    const blank: Question = { id, prompt: { text: "" }, answer: { text: "" } };
    update({
      ...draft,
      questions: [...draft.questions, blank],
      modes: {
        ...draft.modes,
        pubQuiz: { questionOrder: [...order, id], pointsPerQuestion: points },
      },
    });
    setSelected(order.length);
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...order];
    const [id] = next.splice(i, 1);
    next.splice(i + by, 0, id!);
    setQuiz({ questionOrder: next });
    if (selected === i) setSelected(i + by);
  };
  const removeAt = (i: number) => {
    setQuiz({ questionOrder: order.filter((_id, n) => n !== i) });
    setSelected(null);
  };

  const check = quizPreflight(draft, view.teams.length);
  const editing = selected !== null ? byId.get(order[selected] ?? "") : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          Quiz title
          <input
            className={field}
            value={draft.title}
            maxLength={GRID_LIMITS.maxTitle}
            onChange={(e) => update({ ...draft, title: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Points per correct answer
          <input
            type="number"
            className={cn(field, "w-28")}
            min={1}
            max={GRID_LIMITS.maxPoints}
            value={points}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (n >= 1 && n <= GRID_LIMITS.maxPoints) {
                setQuiz({ pointsPerQuestion: n });
              }
            }}
          />
        </label>
      </div>

      <ol aria-label="Questions in order" className="flex flex-col gap-1.5">
        {order.map((id, i) => {
          const q = byId.get(id);
          const ready = !!q?.prompt.text && !!q.answer.text;
          return (
            <li
              key={`${i}:${id}`}
              data-testid="quiz-editor-question"
              className={cn(
                "border-border flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
                selected === i && "border-primary ring-ring ring-2",
                ready ? "bg-surface-sunken" : "bg-warning-soft",
              )}
            >
              <span className="text-muted-foreground w-6 text-right tabular-nums">
                {i + 1}.
              </span>
              <button
                type="button"
                aria-label={`Edit question ${i + 1}`}
                aria-pressed={selected === i}
                className="flex min-w-0 flex-1 flex-col items-start text-left"
                onClick={() => setSelected(i)}
              >
                <span className="w-full truncate">
                  {q?.prompt.text.length ? q.prompt.text : "Needs a question"}
                </span>
                <span className="text-muted-foreground w-full truncate text-xs">
                  {q?.answer.text ? `→ ${q.answer.text}` : ""}
                </span>
              </button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Move question ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Move question ${i + 1} down`}
                disabled={i === order.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                aria-label={`Remove question ${i + 1} from the quiz`}
                onClick={() => removeAt(i)}
              >
                ✕
              </Button>
            </li>
          );
        })}
        {order.length === 0 && (
          <li className="text-muted-foreground text-sm">
            No questions yet. Add one, or load the sample quiz.
          </li>
        )}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={order.length >= QUIZ_LIMITS.maxQuestions}
          onClick={addQuestion}
        >
          Add question
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (
              window.confirm("Replace the quiz with the sample holiday quiz?")
            ) {
              update(sampleQuizBank());
              setSelected(null);
            }
          }}
        >
          Load sample quiz
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowJson((s) => !s)}
        >
          {showJson ? "Hide import/export" : "Import or export"}
        </Button>
      </div>

      {unused.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">
            {unused.length} {unused.length === 1 ? "question" : "questions"} in
            the bank but not in the quiz
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {unused.map((q) => (
              <li key={q.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {q.prompt.text || `(${q.id}, no question yet)`}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={order.length >= QUIZ_LIMITS.maxQuestions}
                  onClick={() => setQuiz({ questionOrder: [...order, q.id] })}
                >
                  Add to quiz
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {editing && selected !== null && (
        <QuestionEditor
          key={`${selected}:${editing.id}`}
          title={`Question ${selected + 1}`}
          question={editing}
          onChange={(q) =>
            update({
              ...draft,
              questions: draft.questions.map((x) =>
                x.id === editing.id ? q : x,
              ),
            })
          }
          onClose={() => setSelected(null)}
        />
      )}

      {showJson && (
        <BankJson
          bank={draft}
          description="The quiz as a question bank. Copy it to keep a backup, or paste one to replace the quiz. A bank with a grid layout keeps it."
          onImport={(b) => {
            update(
              b.modes.pubQuiz
                ? b
                : {
                    ...b,
                    modes: {
                      ...b.modes,
                      pubQuiz: { questionOrder: [], pointsPerQuestion: 1 },
                    },
                  },
            );
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
          {save.isPending ? "Saving…" : dirty ? "Save quiz" : "Saved"}
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
                "Start the quiz? The questions are locked once it starts.",
              )
            ) {
              start.mutate();
            }
          }}
        >
          Start quiz
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
                  "Discard this quiz setup? Its questions are deleted (export them first to keep a copy).",
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

// ------------------------------------------------------------- controls

const VERDICT_LABEL = {
  correct: "✓ Correct",
  incorrect: "✕ Wrong",
  missing: "No answer",
} as const;

function QuizControls({ view }: { view: HostView }) {
  const utils = api.useUtils();
  const content = view.content!;
  const state = view.state!;
  const publicView = view.view;
  const running = view.status === "running";
  const phase = state.phase;
  const refresh = () => {
    void utils.sequentialQuiz.hostView.invalidate();
    void utils.sequentialQuiz.responses.invalidate();
  };

  const responsesQuery = api.sequentialQuiz.responses.useQuery(undefined, {
    enabled: running,
  });
  const refreshKey = `${publicView?.question?.key}|${phase}|${publicView?.answerVersion}|${view.step}`;
  useEffect(() => {
    void utils.sequentialQuiz.responses.invalidate();
  }, [refreshKey, utils]);

  // The step this screen last saw: our own actions advance it at once.
  const lastStep = useRef(view.step);
  const step = () => Math.max(view.step, lastStep.current);
  const advanced = ({ step: next }: { step: number }) => {
    lastStep.current = next;
  };
  const act = api.sequentialQuiz.act.useMutation({
    // Marks skip the step check, so their reply says nothing about whether
    // this screen is up to date: only step-checked actions advance it.
    onSuccess: (result, { action }) => {
      if (action.type !== "grade") advanced(result);
    },
    onSettled: refresh,
  });
  const undo = api.sequentialQuiz.undo.useMutation({
    onSuccess: advanced,
    onSettled: refresh,
  });
  const end = api.sequentialQuiz.end.useMutation({ onSettled: refresh });
  const send = (action: Action) =>
    act.mutate({ action, expectedStep: step(), requestId: newRequestId() });
  const busy = act.isPending || undo.isPending;

  const order = quizOrder(content);
  const question =
    state.position >= 0
      ? content.questions.find((q) => q.id === order[state.position])
      : undefined;
  const isLast = state.position + 1 >= order.length;
  const canNext = running && (phase === "ready" || phase === "revealed");
  const responses =
    responsesQuery.data?.questionKey === publicView?.question?.key
      ? (responsesQuery.data?.responses ?? [])
      : [];
  // The question and verdicts this screen shows: sent with each mark so two
  // hosts can't silently overwrite each other, and a mark from a screen
  // that hasn't caught up never lands on the next question.
  const grades = state.grades;
  const grade = (teams: string[], verdict: "correct" | "incorrect") =>
    send({
      type: "grade",
      key: publicView?.question?.key ?? "",
      teams,
      verdict,
      from: Object.fromEntries(teams.map((t) => [t, grades[t] ?? null])),
    });
  const ungraded = state.teams.filter((t) => !grades[t]);
  const accepted = new Set(
    question
      ? [question.answer.text, ...(question.answer.acceptedAnswers ?? [])]
          .map(normalizeAnswer)
          .filter(Boolean)
      : [],
  );
  const matching = responses.filter(
    (r) =>
      r.normalized !== null &&
      accepted.has(r.normalized) &&
      grades[r.team] !== "correct",
  );

  useHotkeys(
    {
      n: canNext && !isLast ? () => send({ type: "next" }) : undefined,
      l: running && phase === "open" ? () => send({ type: "lock" }) : undefined,
      r:
        running && phase === "locked" && ungraded.length === 0
          ? () => send({ type: "reveal" })
          : undefined,
    },
    !busy,
  );

  return (
    <div className="flex flex-col gap-4">
      {publicView && (
        <SequentialQuizBoard
          view={publicView}
          teams={view.teams}
          hostAnswer={question?.answer.text}
        />
      )}

      {running && question && phase !== "finished" && (
        <div className="bg-surface-sunken flex flex-col gap-1 rounded-lg p-3 text-sm">
          <p>
            <strong>Answer:</strong> {question.answer.text}
            {question.answer.acceptedAnswers?.length
              ? ` (also accept: ${question.answer.acceptedAnswers.join(", ")})`
              : ""}
          </p>
          {question.hostNotes && (
            <p className="text-muted-foreground">
              <strong>Notes:</strong> {question.hostNotes}
            </p>
          )}
        </div>
      )}

      {running && phase !== "finished" && (
        <div data-testid="quiz-controls" className="flex flex-wrap gap-2">
          {canNext && !isLast && (
            <Button
              disabled={busy}
              aria-keyshortcuts="N"
              onClick={() => send({ type: "next" })}
            >
              {state.position < 0 ? "Open first question" : "Next question"}
            </Button>
          )}
          {phase === "open" && (
            <Button
              disabled={busy}
              aria-keyshortcuts="L"
              onClick={() => send({ type: "lock" })}
            >
              Lock answers
            </Button>
          )}
          {phase === "locked" && !state.answerShown && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => send({ type: "reopen" })}
            >
              Reopen answers
            </Button>
          )}
          {phase === "locked" && (
            <Button
              className="bg-success text-success-foreground hover:bg-success/90"
              disabled={busy || ungraded.length > 0}
              aria-keyshortcuts="R"
              title={
                ungraded.length > 0
                  ? "Mark every team first, or use Mark the rest wrong"
                  : undefined
              }
              onClick={() => send({ type: "reveal" })}
            >
              Reveal answer
              {ungraded.length > 0 ? ` (${ungraded.length} unmarked)` : ""}
            </Button>
          )}
          {canNext && (
            <Button
              variant={isLast ? "default" : "secondary"}
              disabled={busy}
              onClick={() => {
                if (
                  isLast ||
                  window.confirm(
                    `Finish the quiz now? ${order.length - state.position - 1} questions haven't been asked.`,
                  )
                ) {
                  send({ type: "finish" });
                }
              }}
            >
              Finish quiz
            </Button>
          )}
          {(phase === "open" || phase === "locked") && (
            <Button
              variant="ghost"
              className="text-destructive ml-auto"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Void this question? Nobody gets points and the answer isn't shown.",
                  )
                ) {
                  send({ type: "void" });
                }
              }}
            >
              Void question
            </Button>
          )}
        </div>
      )}

      {running && (phase === "open" || phase === "locked") && (
        <Responses
          responses={responses}
          grades={grades}
          canMark={phase === "locked" && !busy}
          onGrade={grade}
          matching={matching.map((r) => r.team)}
          onResolveRest={() => send({ type: "resolveRemaining" })}
          ungraded={ungraded.length}
        />
      )}

      {running && phase !== "finished" && (
        <p className="text-muted-foreground text-xs">
          Keyboard:{" "}
          {hotkeyHint([
            ["N", "next question"],
            ["L", "lock answers"],
            ["R", "reveal"],
          ])}
        </p>
      )}

      <ErrorNotice
        error={act.error ?? undo.error ?? end.error ?? responsesQuery.error}
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
                  "Stop the quiz and use basic controls? Scores, players and chat stay. You can't come back to this quiz in this room.",
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
          Undo takes back the last action and its points. Undoing a reveal goes
          back to marking with the answer still showing.
        </p>
      )}
      {running && phase === "finished" && (
        <p className="text-sm">
          The quiz is finished. Final scores are on the scoreboard.
        </p>
      )}
      {view.status === "ended" && (
        <p className="text-sm">
          The quiz has ended. Use the Play tab for buzzers and scores.
        </p>
      )}
    </div>
  );
}

type Group = { normalized: string; text: string; teams: Response[] };

/**
 * Teams' answers for marking: identical answers (ignoring case, spaces
 * and punctuation) grouped, so one tap marks a whole group.
 */
function Responses({
  responses,
  grades,
  canMark,
  onGrade,
  matching,
  onResolveRest,
  ungraded,
}: {
  responses: Response[];
  grades: Record<string, "correct" | "incorrect" | "missing">;
  canMark: boolean;
  onGrade: (teams: string[], verdict: "correct" | "incorrect") => void;
  matching: string[];
  onResolveRest: () => void;
  ungraded: number;
}) {
  const groups: Group[] = [];
  for (const r of responses) {
    if (r.normalized === null) continue;
    const g = groups.find((x) => x.normalized === r.normalized);
    if (g) g.teams.push(r);
    else groups.push({ normalized: r.normalized, text: r.text!, teams: [r] });
  }
  groups.sort((a, b) => b.teams.length - a.teams.length);
  const silent = responses.filter((r) => r.normalized === null);

  const verdictPill = (team: string) => {
    const v = grades[team];
    return v ? (
      <StatusPill
        tone={
          v === "correct" ? "success" : v === "incorrect" ? "danger" : "neutral"
        }
      >
        {VERDICT_LABEL[v]}
      </StatusPill>
    ) : null;
  };
  const markButtons = (teams: string[], label: string) => (
    <span className="flex gap-1">
      <Button
        size="sm"
        className="bg-success text-success-foreground hover:bg-success/90"
        disabled={!canMark || teams.every((t) => grades[t] === "correct")}
        aria-label={`Mark ${label} correct`}
        onClick={() => onGrade(teams, "correct")}
      >
        ✓
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={!canMark || teams.every((t) => grades[t] === "incorrect")}
        aria-label={`Mark ${label} wrong`}
        onClick={() => onGrade(teams, "incorrect")}
      >
        ✕
      </Button>
    </span>
  );

  return (
    <div data-testid="quiz-responses" className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">
          Answers ({responses.length - silent.length} of {responses.length})
        </h3>
        {!canMark && (
          <span className="text-muted-foreground">
            Lock answers to mark them.
          </span>
        )}
        {canMark && matching.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onGrade(matching, "correct")}
          >
            Mark exact matches correct ({matching.length})
          </Button>
        )}
        {canMark && ungraded > 0 && (
          <Button
            size="sm"
            variant="secondary"
            title="Every unmarked team: wrong if it answered, no answer if it didn't"
            onClick={onResolveRest}
          >
            Mark the rest wrong ({ungraded})
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {groups.map((g) => {
          const ids = g.teams.map((t) => t.team);
          return (
            <li
              key={g.normalized}
              data-testid="quiz-response-group"
              className="border-border flex flex-col gap-1 rounded-md border p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 font-semibold break-words">
                  &ldquo;{g.text}&rdquo;
                  {g.teams.length > 1 && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {g.teams.length} teams
                    </span>
                  )}
                </span>
                {g.teams.length > 1 &&
                  markButtons(ids, `everyone who answered ${g.text}`)}
              </div>
              <ul className="flex flex-col gap-1 pl-2">
                {g.teams.map((r) => (
                  <li
                    key={r.team}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="min-w-0 flex-1">
                      {r.teamName}
                      {r.text !== g.text && (
                        <span className="text-muted-foreground">
                          {" "}
                          (&ldquo;{r.text}&rdquo;)
                        </span>
                      )}
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        · {r.savedBy}
                      </span>
                    </span>
                    {verdictPill(r.team)}
                    {markButtons([r.team], r.teamName)}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {silent.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-muted-foreground">No answer</h4>
          <ul className="flex flex-col gap-1 pl-2">
            {silent.map((r) => (
              <li key={r.team} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">{r.teamName}</span>
                {verdictPill(r.team)}
                {markButtons([r.team], r.teamName)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
