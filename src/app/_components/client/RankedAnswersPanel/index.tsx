"use client";

import { useEffect, useRef, useState } from "react";

import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { RankedAnswersBoard } from "@/app/_components/client/RankedAnswersBoard";
import { RankedRulesEditor } from "@/app/_components/client/RankedRulesEditor";
import { Button } from "@/app/_components/ui/button";
import { Notice } from "@/app/_components/ui/page";
import { helpHref } from "@/help/manifest";
import { api, type RouterOutputs } from "@/trpc/react";
import { newRequestId } from "@/utils/requestId";
import { hotkeyHint, useHotkeys } from "@/utils/useHotkeys";
import {
  LIMITS,
  contentSchema,
  pointsFor,
  preflight,
  resolveRules,
  type Board,
  type ResolvedRules,
  type Content,
  type Rules,
} from "@/utils/rankedAnswers/content";
import { stealersOf } from "@/utils/rankedAnswers/engine";
import { sampleContent } from "@/utils/rankedAnswers/sample";

type HostView = RouterOutputs["rankedAnswers"]["hostView"];

const field = "field px-2 py-1 text-sm";

/**
 * The host desk's Ranked Answers tab: set up boards, then run them. Only
 * owners and co-hosts see it, because it shows every answer.
 */
export function RankedAnswersPanel() {
  const utils = api.useUtils();
  const query = api.rankedAnswers.hostView.useQuery();
  const live = useLiveGameState();
  const modeKey = JSON.stringify(live.data?.mode ?? null);
  // Another host acting changes the public board: refresh this view.
  useEffect(() => {
    void utils.rankedAnswers.hostView.invalidate();
  }, [modeKey, utils]);

  if (query.error) return <ErrorNotice error={query.error} />;
  const view = query.data;
  if (!view) return <p className="text-sm">Loading…</p>;

  return (
    <section
      aria-label="Ranked Answers"
      className="bg-surface border-border flex w-full flex-col gap-4 rounded-xl border p-4 shadow-sm"
    >
      <p className="text-muted-foreground text-sm">
        <strong>Ranked Answers</strong>: teams guess the answers on a board,
        family-feud style. Points go straight onto the scoreboard.{" "}
        <a
          className="underline"
          href={helpHref("ranked-answers")}
          target="_blank"
          rel="noopener"
        >
          How it works
        </a>
      </p>
      {view.otherMode ? (
        <OtherModeNotice mode={view.otherMode} />
      ) : view.status === "none" || view.status === "draft" ? (
        <Editor view={view} />
      ) : (
        <Controls view={view} />
      )}
    </section>
  );
}

/** The game is set up for a different mode; explain how to switch. */
export function OtherModeNotice({ mode }: { mode: string }) {
  const name = mode === "categoryGrid" ? "Category Grid" : "Ranked Answers";
  return (
    <Notice tone="info">
      This game is set up for <strong>{name}</strong>. A game runs one game
      mode. To use this one instead, open the {name} tab and choose{" "}
      <strong>Discard setup</strong> (only possible before it starts), or
      duplicate the game.
    </Notice>
  );
}

// ------------------------------------------------------------- editor

function Editor({ view }: { view: HostView }) {
  const utils = api.useUtils();
  const [draft, setDraft] = useState<Content>(view.draft);
  const [revision, setRevision] = useState(view.draftRevision);
  const [dirty, setDirty] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const teamCount = view.teams.length;

  // Pick up another host's save, unless there are unsaved edits here.
  if (!dirty && view.draftRevision !== revision) {
    setDraft(view.draft);
    setRevision(view.draftRevision);
  }

  const save = api.rankedAnswers.saveDraft.useMutation({
    onSuccess: ({ draftRevision }) => {
      setRevision(draftRevision);
      setDirty(false);
      void utils.rankedAnswers.hostView.invalidate();
    },
  });
  const start = api.rankedAnswers.start.useMutation({
    onSuccess: () => utils.rankedAnswers.hostView.invalidate(),
  });
  const discard = api.rankedAnswers.discardDraft.useMutation({
    onSuccess: () => {
      setDirty(false);
      void utils.rankedAnswers.hostView.invalidate();
      void utils.categoryGrid.hostView.invalidate();
    },
  });

  const update = (next: Content) => {
    setDraft(next);
    setDirty(true);
    save.reset();
  };
  const setBoard = (i: number, board: Board | null) => {
    const boards = [...draft.boards];
    if (board) boards[i] = board;
    else boards.splice(i, 1);
    update({ ...draft, boards });
  };
  const moveBoard = (i: number, by: number) => {
    const boards = [...draft.boards];
    const [b] = boards.splice(i, 1);
    boards.splice(i + by, 0, b!);
    update({ ...draft, boards });
  };

  const check = preflight(draft, teamCount);

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Rules"
        className="border-border flex flex-col gap-2 rounded-lg border p-3"
      >
        <h3 className="font-semibold">
          Rules{" "}
          <span className="text-muted-foreground text-sm font-normal">
            ({teamCount} teams in this game)
          </span>
        </h3>
        <RankedRulesEditor
          rules={draft.rules}
          teamCount={teamCount}
          onChange={(rules) => update({ ...draft, rules })}
        />
      </section>

      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">Boards ({draft.boards.length})</h3>
        {draft.boards.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No boards yet. Add one, or load the sample to see how it works.
          </p>
        )}
        {draft.boards.map((board, i) => (
          <BoardEditor
            key={board.id}
            index={i}
            board={board}
            rules={draft.rules}
            count={draft.boards.length}
            onChange={(b) => setBoard(i, b)}
            onMove={(by) => moveBoard(i, by)}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={draft.boards.length >= LIMITS.maxBoards}
            onClick={() =>
              update({
                ...draft,
                boards: [
                  ...draft.boards,
                  {
                    id: newRequestId().slice(0, 12),
                    role: "main",
                    prompt: "",
                    answers: Array.from({ length: 4 }, () => ({
                      id: newRequestId().slice(0, 12),
                      text: "",
                      aliases: [],
                    })),
                  },
                ],
              })
            }
          >
            Add board
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (
                draft.boards.length === 0 ||
                window.confirm("Replace your boards with the sample boards?")
              ) {
                update(sampleContent(teamCount));
              }
            }}
          >
            Load sample boards
          </Button>
          <Button variant="secondary" onClick={() => setShowJson((s) => !s)}>
            {showJson ? "Hide import/export" : "Import or export"}
          </Button>
        </div>
        {showJson && <JsonBox draft={draft} onImport={update} />}
      </div>

      <Preflight check={check} />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ draft, expectedRevision: revision })}
        >
          {save.isPending ? "Saving…" : dirty ? "Save boards" : "Saved"}
        </Button>
        <Button
          variant="default"
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
                "Start Ranked Answers? The boards are locked once it starts.",
              )
            ) {
              start.mutate();
            }
          }}
        >
          Start Ranked Answers
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
                  "Discard this Ranked Answers setup? Its rules and boards are deleted (export them first to keep a copy).",
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
      <ErrorNotice
        error={save.error ?? start.error ?? discard.error}
        className="text-destructive text-sm"
      />
    </div>
  );
}

function BoardEditor({
  index,
  board,
  rules,
  count,
  onChange,
  onMove,
}: {
  index: number;
  board: Board;
  rules: Rules;
  count: number;
  onChange: (b: Board | null) => void;
  onMove: (by: number) => void;
}) {
  const ownPoints = board.answers.some((a) => a.points !== undefined);
  const setAnswer = (i: number, patch: Partial<Board["answers"][number]>) =>
    onChange({
      ...board,
      answers: board.answers.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    });
  return (
    <fieldset
      data-testid="board-editor"
      className="border-border flex flex-col gap-2 rounded border p-3"
    >
      <legend className="px-1 text-sm font-semibold">Board {index + 1}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Prompt
          <input
            className={field}
            value={board.prompt}
            maxLength={LIMITS.maxPromptLength}
            placeholder="Things people hang on a holiday tree"
            onChange={(e) => onChange({ ...board, prompt: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select
            className={field}
            value={board.role}
            onChange={(e) =>
              onChange({ ...board, role: e.target.value as Board["role"] })
            }
          >
            <option value="main">Main</option>
            <option value="practice">Practice (no points)</option>
            <option value="spare">Spare (tie-break)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Multiplier
          <select
            className={field}
            value={board.multiplier ?? ""}
            onChange={(e) =>
              onChange({
                ...board,
                multiplier: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          >
            <option value="">Game&apos;s ({rules.multiplier}×)</option>
            {[1, 2, 3].map((m) => (
              <option key={m} value={m}>
                {m}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={ownPoints}
          onChange={(e) =>
            onChange({
              ...board,
              answers: board.answers.map((a, i) => ({
                ...a,
                points: e.target.checked
                  ? (rules.pointValuesByRank[i] ?? 1)
                  : undefined,
              })),
            })
          }
        />
        Set points for each answer (for example survey counts)
      </label>
      <ol className="flex flex-col gap-1">
        {board.answers.map((answer, i) => (
          <li key={answer.id} className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-right text-sm font-bold">{i + 1}</span>
            <input
              aria-label={`Board ${index + 1} answer ${i + 1}`}
              className={`${field} min-w-32 flex-1`}
              value={answer.text}
              maxLength={LIMITS.maxAnswerLength}
              onChange={(e) => setAnswer(i, { text: e.target.value })}
            />
            <input
              aria-label={`Board ${index + 1} answer ${i + 1} also accept`}
              className={`${field} min-w-32 flex-1`}
              placeholder="Also accept (comma-separated)"
              value={answer.aliases.join(", ")}
              onChange={(e) =>
                setAnswer(i, {
                  aliases: e.target.value
                    .split(",")
                    .map((s) => s.trimStart())
                    .slice(0, LIMITS.maxAliases),
                })
              }
              onBlur={() =>
                setAnswer(i, {
                  aliases: answer.aliases.map((s) => s.trim()).filter(Boolean),
                })
              }
            />
            {ownPoints ? (
              <input
                type="number"
                aria-label={`Board ${index + 1} answer ${i + 1} points`}
                className={`${field} w-20`}
                min={1}
                max={LIMITS.maxPoints}
                value={answer.points ?? ""}
                onChange={(e) =>
                  setAnswer(i, {
                    points: Math.max(
                      1,
                      Math.round(Number(e.target.value)) || 1,
                    ),
                  })
                }
              />
            ) : (
              <span className="text-muted-foreground w-20 text-sm">
                {pointsFor(rules, board, i + 1)} pts
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Remove answer ${i + 1}`}
              onClick={() =>
                onChange({
                  ...board,
                  answers: board.answers.filter((_, j) => j !== i),
                })
              }
            >
              ✕
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={board.answers.length >= LIMITS.maxAnswers}
          onClick={() =>
            onChange({
              ...board,
              answers: [
                ...board.answers,
                {
                  id: newRequestId().slice(0, 12),
                  text: "",
                  aliases: [],
                  ...(ownPoints ? { points: 1 } : {}),
                },
              ],
            })
          }
        >
          Add answer
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          Move up
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          Move down
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => {
            if (window.confirm(`Delete board ${index + 1}?`)) onChange(null);
          }}
        >
          Delete board
        </Button>
      </div>
    </fieldset>
  );
}

function JsonBox({
  draft,
  onImport,
}: {
  draft: Content;
  onImport: (c: Content) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(draft, null, 2));
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        Copy this to keep a backup or edit it elsewhere. Paste boards here and
        choose Import to replace the current ones.
      </p>
      <textarea
        aria-label="Boards as JSON"
        className={`${field} h-48 font-mono text-xs`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            try {
              const parsed = contentSchema.safeParse(JSON.parse(text));
              if (!parsed.success) {
                setProblem(
                  parsed.error.issues
                    .slice(0, 3)
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join("; "),
                );
                return;
              }
              setProblem(null);
              onImport(parsed.data);
            } catch {
              setProblem("That isn't valid JSON.");
            }
          }}
        >
          Import
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setText(JSON.stringify(draft, null, 2))}
        >
          Show current boards
        </Button>
      </div>
      {problem && <p className="text-destructive">{problem}</p>}
    </div>
  );
}

function Preflight({
  check,
}: {
  check: { blocking: string[]; warnings: string[] };
}) {
  if (check.blocking.length === 0 && check.warnings.length === 0) {
    return <p className="text-success text-sm">Ready to start.</p>;
  }
  return (
    <div data-testid="preflight" className="flex flex-col gap-2 text-sm">
      {check.blocking.length > 0 && (
        <div>
          <p className="text-destructive font-semibold">Fix before starting</p>
          <ul className="list-disc pl-5">
            {check.blocking.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {check.warnings.length > 0 && (
        <div>
          <p className="text-warning-text font-semibold">Worth knowing</p>
          <ul className="list-disc pl-5">
            {check.warnings.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- controls

function Controls({ view }: { view: HostView }) {
  const utils = api.useUtils();
  const content = view.content!;
  const state = view.state!;
  const board = state.board;
  const boardContent = board
    ? content.boards.find((b) => b.id === board.boardId)
    : undefined;
  const names = Object.fromEntries(view.teams.map((t) => [t.id, t.name]));
  const refresh = () => utils.rankedAnswers.hostView.invalidate();
  // The step this screen last saw: our own actions advance it at once, so a
  // quick second click doesn't wait for the refreshed view.
  const lastStep = useRef(view.step);
  const step = () => Math.max(view.step, lastStep.current);
  const advanced = ({ step: next }: { step: number }) => {
    lastStep.current = next;
  };
  const act = api.rankedAnswers.act.useMutation({
    onSuccess: advanced,
    onSettled: refresh,
  });
  const undo = api.rankedAnswers.undo.useMutation({
    onSuccess: advanced,
    onSettled: refresh,
  });
  const end = api.rankedAnswers.end.useMutation({ onSettled: refresh });
  const send = (
    action: Parameters<typeof act.mutate>[0]["action"],
    onDone?: () => void,
  ) =>
    act.mutate(
      { action, expectedStep: step(), requestId: newRequestId() },
      onDone ? { onSuccess: onDone } : undefined,
    );
  const busy = act.isPending || undo.isPending;
  const running = view.status === "running";

  const hidden = boardContent
    ? boardContent.answers
        .map((a, i) => ({ ...a, rank: i + 1 }))
        .filter((a) => !board!.revealed.some((r) => r.rank === a.rank))
    : [];

  return (
    <div className="flex flex-col gap-4">
      {view.view && (
        <RankedAnswersBoard
          view={view.view}
          names={names}
          hostAnswers={
            boardContent && board
              ? boardContent.answers.map((a, i) => ({
                  text: a.text,
                  points:
                    boardContent.role === "practice"
                      ? 0
                      : pointsFor(content.rules, boardContent, i + 1),
                }))
              : undefined
          }
        />
      )}
      {boardContent && board && board.phase !== "closed" && (
        <p className="text-muted-foreground text-xs">
          Answers in <em>italics</em> are hidden from players. Also accept:{" "}
          {hidden
            .filter((a) => a.aliases.length > 0)
            .map((a) => `${a.text} (${a.aliases.join(", ")})`)
            .join("; ") || "none"}
        </p>
      )}

      {running && !state.finished && (
        <div data-testid="ranked-controls" className="flex flex-col gap-3">
          {(!board || board.phase === "closed") && (
            <NextBoard
              view={view}
              disabled={busy}
              onStart={(boardId, teams) =>
                send({
                  type: "startBoard",
                  boardId,
                  ...(teams ? { teams } : {}),
                })
              }
              onReveal={
                board && hidden.length > 0
                  ? () => send({ type: "revealRemaining" })
                  : undefined
              }
              onFinish={() => send({ type: "finish" })}
            />
          )}
          {board && boardContent && board.phase !== "closed" && (
            <PhaseControls
              view={view}
              names={names}
              hidden={hidden}
              disabled={busy}
              send={send}
            />
          )}
        </div>
      )}

      <ErrorNotice
        error={act.error ?? undo.error ?? end.error}
        className="text-destructive text-sm"
      />

      {running && (
        <div className="border-border flex flex-wrap gap-2 border-t pt-3">
          <Button
            variant="secondary"
            disabled={!view.canUndo || busy}
            onClick={() =>
              undo.mutate({
                expectedStep: step(),
                requestId: newRequestId(),
              })
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
                  "Stop Ranked Answers and use basic controls? Scores, players and chat stay. You can't come back to this board game in this room.",
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
          Undo takes back the points of the last action. Answers already shown
          stay shown, for 0 points.
        </p>
      )}
      {view.status === "ended" && (
        <p className="text-sm">
          Ranked Answers has ended. Use the Play tab for buzzers and scores.
        </p>
      )}
    </div>
  );
}

function NextBoard({
  view,
  disabled,
  onStart,
  onReveal,
  onFinish,
}: {
  view: HostView;
  disabled: boolean;
  onStart: (boardId: string, teams?: string[]) => void;
  onReveal?: () => void;
  onFinish: () => void;
}) {
  const content = view.content!;
  const state = view.state!;
  const remaining = content.boards.filter(
    (b) => !state.boardsPlayed.includes(b.id),
  );
  const [boardId, setBoardId] = useState(remaining[0]?.id ?? "");
  const [tied, setTied] = useState<string[]>([]);
  const chosen = remaining.find((b) => b.id === boardId) ?? remaining[0];

  return (
    <div className="flex flex-col gap-2">
      {onReveal && (
        <Button variant="secondary" disabled={disabled} onClick={onReveal}>
          Reveal remaining answers (0 points)
        </Button>
      )}
      {remaining.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Next board
            <select
              className={field}
              value={chosen?.id ?? ""}
              onChange={(e) => setBoardId(e.target.value)}
            >
              {remaining.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.role === "main" ? "" : `[${b.role}] `}
                  {b.prompt}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={
              disabled ||
              !chosen ||
              (chosen.role === "spare" && tied.length === 1)
            }
            onClick={() =>
              chosen &&
              onStart(
                chosen.id,
                chosen.role === "spare" && tied.length >= 2 ? tied : undefined,
              )
            }
          >
            Show this board
          </Button>
        </div>
      ) : (
        <p className="text-sm">Every board has been played.</p>
      )}
      {chosen?.role === "spare" && (
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend>Tie-break between (leave empty for all teams):</legend>
          {view.teams.map((t) => (
            <label key={t.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={tied.includes(t.id)}
                onChange={(e) =>
                  setTied((cur) =>
                    e.target.checked
                      ? [...cur, t.id]
                      : cur.filter((x) => x !== t.id),
                  )
                }
              />
              {t.name}
            </label>
          ))}
        </fieldset>
      )}
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          if (
            window.confirm(
              "Finish Ranked Answers and show the final board screen?",
            )
          ) {
            onFinish();
          }
        }}
      >
        Finish Ranked Answers
      </Button>
    </div>
  );
}

type Hidden = { id: string; text: string; rank: number }[];

/** A select of the hidden answers, plus "wrong". Empty string = not chosen. */
function AnswerSelect({
  label,
  hidden,
  value,
  onChange,
}: {
  label: string;
  hidden: Hidden;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select
        aria-label={label}
        className={field}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        <option value="wrong">✕ Wrong / no answer</option>
        {hidden.map((a) => (
          <option key={a.id} value={a.id}>
            #{a.rank} {a.text}
          </option>
        ))}
      </select>
    </label>
  );
}

const asAnswer = (v: string) => (v === "wrong" ? null : v);

/**
 * The hidden answers as buttons, plus a wrong/strike button. Keyboard:
 * the answer's number reveals it, X records a miss.
 */
function AnswerButtons({
  hidden,
  disabled,
  onPick,
  wrongLabel,
}: {
  hidden: Hidden;
  disabled: boolean;
  onPick: (answerId: string | null) => void;
  wrongLabel: string;
}) {
  useHotkeys(
    {
      ...Object.fromEntries(
        hidden.map((a) => [String(a.rank), () => onPick(a.id)]),
      ),
      x: () => onPick(null),
    },
    !disabled,
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {hidden.map((a) => (
          <Button
            key={a.id}
            disabled={disabled}
            className="bg-info text-info-foreground hover:bg-info/90"
            aria-keyshortcuts={String(a.rank)}
            onClick={() => onPick(a.id)}
          >
            #{a.rank} {a.text}
          </Button>
        ))}
        <Button
          variant="destructive"
          disabled={disabled}
          aria-keyshortcuts="X"
          onClick={() => onPick(null)}
        >
          {wrongLabel}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Keyboard:{" "}
        {hotkeyHint([
          ["1–8", "answer"],
          ["X", "miss"],
        ])}
      </p>
    </div>
  );
}

function PhaseControls({
  view,
  names,
  hidden,
  disabled,
  send,
}: {
  view: HostView;
  names: Record<string, string>;
  hidden: Hidden;
  disabled: boolean;
  send: (
    action: Parameters<
      ReturnType<typeof api.rankedAnswers.act.useMutation>["mutate"]
    >[0]["action"],
    onDone?: () => void,
  ) => void;
}) {
  const board = view.state!.board!;
  const rules = view.content!.rules;
  const opts = resolveRules(rules);
  const live = useLiveGameState().data;
  // Whoever holds the buzz right now, to pre-fill "who buzzed".
  const holder =
    live?.game.buzzerMode === "queue"
      ? live.buzzQueue.find((e) => e.status === "answering")?.gameTeamId
      : live?.buzzWinner?.gameTeamId;
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [chosenFirst, setFirst] = useState<string | null>(null);
  const first =
    chosenFirst ??
    (holder && board.faceOffTeams.includes(holder)
      ? holder
      : (board.faceOffTeams[0] ?? ""));
  const step = useRef(view.step);
  // Clear the form whenever the board moves on.
  useEffect(() => {
    if (step.current !== view.step) {
      step.current = view.step;
      setPicks({});
      setFirst(null);
    }
  }, [view.step]);
  const pick = (team: string) => (v: string) =>
    setPicks((p) => ({ ...p, [team]: v }));
  const name = (id: string | null) =>
    id ? (names[id] ?? "A removed team") : "Team";

  const answerButtons = (
    onPick: (answerId: string | null) => void,
    wrongLabel: string,
  ) => (
    <AnswerButtons
      hidden={hidden}
      disabled={disabled}
      onPick={onPick}
      wrongLabel={wrongLabel}
    />
  );

  const closeButton = (
    <Button
      variant="secondary"
      disabled={disabled}
      onClick={() => {
        if (window.confirm("Close this board now?"))
          send({ type: "closeBoard" });
      }}
    >
      Close board
    </Button>
  );

  switch (board.phase) {
    case "faceOff": {
      const teams = board.faceOffTeams;
      const ready = teams.every((t) => picks[t]);
      const ordered =
        rules.faceOffMethod === "buzzer"
          ? [first, ...teams.filter((t) => t !== first)]
          : teams;
      return (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">
            Face-off: {teams.map((t) => name(t)).join(" vs ")}
          </p>
          {rules.faceOffMethod === "buzzer" && (
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend>Who buzzed first?</legend>
              {teams.map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="buzzed-first"
                    checked={first === t}
                    onChange={() => setFirst(t)}
                  />
                  {name(t)}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap gap-3">
            {teams.map((t) => (
              <AnswerSelect
                key={t}
                label={`${name(t)}'s answer`}
                hidden={hidden}
                value={picks[t] ?? ""}
                onChange={pick(t)}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={disabled || !ready}
              onClick={() =>
                send({
                  type: "faceOff",
                  answers: ordered.map((t) => ({
                    team: t,
                    answerId: asAnswer(picks[t]!),
                  })),
                })
              }
            >
              Record face-off
            </Button>
            {closeButton}
          </div>
        </div>
      );
    }
    case "playOrPass": {
      const winner = board.faceOffWinner!;
      const other = board.faceOffTeams.find((t) => t !== winner)!;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            {name(winner)} won the face-off.
          </span>
          <Button
            disabled={disabled}
            onClick={() => send({ type: "playOrPass", play: true })}
          >
            {name(winner)} plays
          </Button>
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => send({ type: "playOrPass", play: false })}
          >
            Pass to {name(other)}
          </Button>
        </div>
      );
    }
    case "control":
      return (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">
            {name(board.control)} is playing: {board.strikes} of {rules.strikes}{" "}
            strikes
          </p>
          {answerButtons(
            (answerId) => send({ type: "answer", answerId }),
            "✕ Strike",
          )}
          {closeButton}
        </div>
      );
    case "steal": {
      // A team deleted mid-board can't answer.
      const stealers = stealersOf(rules, board).filter((t) => t in names);
      const ready = stealers.every((t) => picks[t]);
      const forBank =
        opts.scoring === "bank" && opts.stealReward === "bankPlusRow";
      return (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">
            Steal{forBank ? ` for ${board.bank} points` : " (row points only)"}:{" "}
            {stealers.map((t) => name(t)).join(", ")}
          </p>
          <div className="flex flex-wrap gap-3">
            {stealers.map((t) => (
              <AnswerSelect
                key={t}
                label={`${name(t)}'s steal`}
                hidden={hidden}
                value={picks[t] ?? ""}
                onChange={pick(t)}
              />
            ))}
          </div>
          <Button
            disabled={disabled || !ready}
            onClick={() =>
              send({
                type: "steal",
                answers: Object.fromEntries(
                  stealers.map((t) => [t, asAnswer(picks[t]!)]),
                ),
              })
            }
          >
            Record steal{stealers.length > 1 ? "s" : ""}
          </Button>
        </div>
      );
    }
    case "turns": {
      const team = board.order[board.turn % board.order.length]!;
      return (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">
            {name(team)}&apos;s turn ({board.turn + 1} of{" "}
            {board.order.length * rules.turnCycles})
            {rules.playStyle === "passAlong" &&
              ": they keep answering until a miss"}
          </p>
          {answerButtons(
            (answerId) => send({ type: "answer", answerId }),
            rules.playStyle === "passAlong"
              ? "✕ Miss: next team"
              : "✕ Wrong / pass",
          )}
          {closeButton}
        </div>
      );
    }
    case "allPlay": {
      const playing = board.teams.filter((t) => t in names);
      const ready = playing.every((t) => picks[t]);
      return (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">
            Round {board.round + 1} of {rules.allPlayRounds}: record each
            team&apos;s answer, then reveal.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {playing.map((t) => (
              <AnswerSelect
                key={t}
                label={name(t)}
                hidden={hidden}
                value={picks[t] ?? ""}
                onChange={pick(t)}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={disabled || !ready}
              onClick={() =>
                send({
                  type: "allPlayRound",
                  answers: Object.fromEntries(
                    playing.map((t) => [t, asAnswer(picks[t]!)]),
                  ),
                })
              }
            >
              Reveal round
            </Button>
            {closeButton}
          </div>
        </div>
      );
    }
    case "open":
      return (
        <OpenControls
          board={board}
          names={names}
          hidden={hidden}
          disabled={disabled}
          penalty={opts.missPenalty}
          send={send}
          closeButton={closeButton}
        />
      );
    case "race":
      return (
        <RaceControls
          board={board}
          names={names}
          holder={holder ?? null}
          rules={opts}
          disabled={disabled}
          answerButtons={answerButtons}
          send={send}
          closeButton={closeButton}
        />
      );
    default:
      return null;
  }
}

/**
 * Open answering: tap every team that got it, then the answer. Tapping an
 * answer with no team chosen just reveals it, for no points.
 */
function OpenControls({
  board,
  names,
  hidden,
  disabled,
  penalty,
  send,
  closeButton,
}: {
  board: NonNullable<HostView["state"]>["board"] & object;
  names: Record<string, string>;
  hidden: Hidden;
  disabled: boolean;
  penalty: number;
  send: (
    action: Parameters<
      ReturnType<typeof api.rankedAnswers.act.useMutation>["mutate"]
    >[0]["action"],
    onDone?: () => void,
  ) => void;
  closeButton: React.ReactNode;
}) {
  const [who, setWho] = useState<string[]>([]);
  const playing = board.teams.filter((t) => t in names);
  const credit = (answerId: string) =>
    send({ type: "credit", answerId, teams: who }, () => setWho([]));
  useHotkeys(
    Object.fromEntries(hidden.map((h) => [String(h.rank), () => credit(h.id)])),
    // A number key never reveals an answer for nobody by accident.
    !disabled && who.length > 0,
  );
  const toggle = (t: string) =>
    setWho((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
    );
  const label =
    who.length === 0
      ? "Reveal for no one"
      : who.map((t) => names[t]).join(" + ");

  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold">Who got it? Tap every team that did.</p>
      <div
        role="group"
        aria-label="Teams that got it"
        className="flex flex-wrap gap-2"
      >
        {playing.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={who.includes(t) ? "default" : "outline"}
            aria-pressed={who.includes(t)}
            disabled={disabled}
            onClick={() => toggle(t)}
          >
            {who.includes(t) ? "✓ " : ""}
            {names[t]}
          </Button>
        ))}
        {who.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setWho([])}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        Then tap the answer they gave ({label})
        {who.length > 0 ? ", or press its number" : ""}.
      </p>
      <div className="flex flex-wrap gap-2">
        {hidden.map((a) => (
          <Button
            key={a.id}
            disabled={disabled}
            className="bg-info text-info-foreground hover:bg-info/90"
            aria-keyshortcuts={String(a.rank)}
            onClick={() => credit(a.id)}
          >
            #{a.rank} {a.text}
          </Button>
        ))}
      </div>
      {penalty > 0 && who.length === 1 && (
        <Button
          variant="destructive"
          disabled={disabled}
          className="self-start"
          onClick={() =>
            send({ type: "miss", team: who[0]! }, () => setWho([]))
          }
        >
          ✕ Wrong: {names[who[0]!]} loses {penalty}
        </Button>
      )}
      {closeButton}
    </div>
  );
}

/**
 * Buzz race: pick who buzzed (pre-filled from the buzzer), then their
 * answer. "Also update the buzzer" marks the buzzer too, so the host
 * doesn't record everything twice.
 */
function RaceControls({
  board,
  names,
  holder,
  rules,
  disabled,
  answerButtons,
  send,
  closeButton,
}: {
  board: NonNullable<HostView["state"]>["board"] & object;
  names: Record<string, string>;
  holder: string | null;
  rules: ResolvedRules;
  disabled: boolean;
  answerButtons: (
    onPick: (answerId: string | null) => void,
    wrongLabel: string,
  ) => React.ReactNode;
  send: (
    action: Parameters<
      ReturnType<typeof api.rankedAnswers.act.useMutation>["mutate"]
    >[0]["action"],
    onDone?: () => void,
  ) => void;
  closeButton: React.ReactNode;
}) {
  const live = useLiveGameState().data;
  const utils = api.useUtils();
  const refresh = () => utils.gameAdmin.buzzer.history.invalidate();
  const open = api.gameAdmin.startBuzzer.useMutation({ onSuccess: refresh });
  const next = api.gameAdmin.resetBuzzer.useMutation({ onSuccess: refresh });
  const judge = api.gameAdmin.buzzer.judge.useMutation({ onSuccess: refresh });
  const [syncBuzzer, setSyncBuzzer] = useState(true);
  const [chosen, setChosen] = useState<string | null>(null);
  const locked = board.lockedOut ?? [];
  const eligible = board.teams.filter((t) => !locked.includes(t));
  const team =
    chosen && eligible.includes(chosen)
      ? chosen
      : holder && eligible.includes(holder)
        ? holder
        : null;
  const name = (id: string) => names[id] ?? "Team";

  /**
   * Mirrors on the real buzzer what the board just decided, once the board
   * action has succeeded: right closes the question; wrong rejects the team
   * only if the rules sit it out; if everyone is out, the buzzer starts
   * afresh so they can all go again.
   */
  const updateBuzzer = (answered: string, hit: boolean) => {
    if (!syncBuzzer || !live || answered !== holder) return;
    const queue = live.game.buzzerMode === "queue";
    const entry = live.buzzQueue.find(
      (e) => e.status === "answering" && e.gameTeamId === answered,
    );
    if (hit) {
      if (queue && entry)
        judge.mutate({ entryId: entry.id, verdict: "correct" });
      else if (!queue) next.mutate();
      return;
    }
    const misses = (board.teamStrikes?.[answered] ?? 0) + 1;
    const sitsOut =
      rules.raceLockout === "untilNextFind" ||
      (rules.raceLockout === "afterStrikes" && misses >= rules.strikes);
    const outAfter = sitsOut ? [...locked, answered] : locked;
    if (board.teams.every((t) => outAfter.includes(t))) {
      // Everyone gets another go (or the board closed): a fresh question.
      next.mutate();
    } else if (sitsOut) {
      if (queue && entry) judge.mutate({ entryId: entry.id, verdict: "wrong" });
      else if (!queue) open.mutate();
    } else if (queue && entry) {
      // No lockout: the next in line answers; this team may buzz again.
      judge.mutate({ entryId: entry.id, verdict: "skip" });
    } else if (!queue) {
      next.mutate(undefined, { onSuccess: () => open.mutate() });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold">
        Buzz race: who buzzed?
        {locked.length > 0 && (
          <span className="text-muted-foreground font-normal">
            {" "}
            Sitting out: {locked.map(name).join(", ")}
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Team answering"
          className={field}
          value={team ?? ""}
          onChange={(e) => setChosen(e.target.value || null)}
        >
          <option value="">Choose a team…</option>
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
            disabled={disabled || open.isPending}
            onClick={() => open.mutate()}
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
      {team ? (
        answerButtons(
          (answerId) => {
            const answered = team;
            send({ type: "raceAnswer", team, answerId }, () =>
              updateBuzzer(answered, answerId !== null),
            );
            setChosen(null);
          },
          `✕ Wrong: ${name(team)}`,
        )
      ) : (
        <p className="text-muted-foreground text-sm">
          Open the buzzer, or choose the team that answered.
        </p>
      )}
      <ErrorNotice error={open.error ?? next.error ?? judge.error} />
      {closeButton}
    </div>
  );
}
