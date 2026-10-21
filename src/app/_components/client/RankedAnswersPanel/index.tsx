"use client";

import { useEffect, useRef, useState } from "react";

import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { RankedAnswersBoard } from "@/app/_components/client/RankedAnswersBoard";
import { Button } from "@/app/_components/ui/button";
import { helpHref } from "@/help/manifest";
import { api, type RouterOutputs } from "@/trpc/react";
import { newRequestId } from "@/utils/requestId";
import {
  LIMITS,
  PLAY_STYLES,
  STYLE_DESCRIPTION,
  STYLE_LABEL,
  STYLE_TEAM_RANGE,
  contentSchema,
  pointsFor,
  preflight,
  suggestedStyle,
  type Board,
  type Content,
  type Rules,
} from "@/utils/rankedAnswers/content";
import { sampleContent } from "@/utils/rankedAnswers/sample";

type HostView = RouterOutputs["rankedAnswers"]["hostView"];

const field =
  "rounded border border-white/30 bg-white/90 px-2 py-1 text-sm text-black";

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
      className="flex w-full flex-col gap-4 rounded-lg bg-white/10 p-4 text-white"
    >
      <p className="text-sm text-white/80">
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
      {view.status === "none" || view.status === "draft" ? (
        <Editor view={view} />
      ) : (
        <Controls view={view} />
      )}
    </section>
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

  const update = (next: Content) => {
    setDraft(next);
    setDirty(true);
    save.reset();
  };
  const setRules = (patch: Partial<Rules>) =>
    update({ ...draft, rules: { ...draft.rules, ...patch } });
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
  const [min, max] = STYLE_TEAM_RANGE[draft.rules.playStyle];

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3 rounded border border-white/20 p-3">
        <legend className="px-1 font-semibold">Rules</legend>
        <label className="flex flex-col gap-1 text-sm">
          Play style ({teamCount} teams in this game; suggested:{" "}
          {STYLE_LABEL[suggestedStyle(teamCount)]})
          <select
            className={field}
            value={draft.rules.playStyle}
            onChange={(e) =>
              setRules({ playStyle: e.target.value as Rules["playStyle"] })
            }
          >
            {PLAY_STYLES.map((style) => (
              <option key={style} value={style}>
                {STYLE_LABEL[style]}
              </option>
            ))}
          </select>
          <span className="text-white/70">
            {STYLE_DESCRIPTION[draft.rules.playStyle]}
            {(teamCount < min || teamCount > max) &&
              ` This style needs ${min === max ? min : `${min}–${max}`} teams.`}
          </span>
        </label>
        <PointsInput
          key={draft.rules.pointValuesByRank.join()}
          value={draft.rules.pointValuesByRank}
          onChange={(pointValuesByRank) => setRules({ pointValuesByRank })}
        />
        <div className="flex flex-wrap gap-3 text-sm">
          <NumberField
            label="Points multiplier"
            value={draft.rules.multiplier}
            min={1}
            max={LIMITS.maxMultiplier}
            onChange={(multiplier) => setRules({ multiplier })}
          />
          {(draft.rules.playStyle === "classic" ||
            draft.rules.playStyle === "faceOffLadder") && (
            <>
              <NumberField
                label="Strikes"
                value={draft.rules.strikes}
                min={1}
                max={5}
                onChange={(strikes) => setRules({ strikes })}
              />
              <label className="flex flex-col gap-1">
                Face-off
                <select
                  className={field}
                  value={draft.rules.faceOffMethod}
                  onChange={(e) =>
                    setRules({
                      faceOffMethod: e.target.value as Rules["faceOffMethod"],
                    })
                  }
                >
                  <option value="buzzer">Buzzer: first to buzz answers</option>
                  <option value="secret">
                    Secret: both answer, higher row wins
                  </option>
                </select>
              </label>
            </>
          )}
          {draft.rules.playStyle === "roundRobin" && (
            <NumberField
              label="Answers per team per board"
              value={draft.rules.turnCycles}
              min={1}
              max={4}
              onChange={(turnCycles) => setRules({ turnCycles })}
            />
          )}
          {draft.rules.playStyle === "allPlay" && (
            <NumberField
              label="Rounds per board"
              value={draft.rules.allPlayRounds}
              min={1}
              max={8}
              onChange={(allPlayRounds) => setRules({ allPlayRounds })}
            />
          )}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">Boards ({draft.boards.length})</h3>
        {draft.boards.length === 0 && (
          <p className="text-sm text-white/80">
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
          className="bg-green-600 hover:bg-green-700"
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
          <span className="text-sm text-amber-300">Unsaved changes</span>
        )}
      </div>
      <ErrorNotice
        error={save.error ?? start.error}
        className="text-sm text-red-300"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input
        type="number"
        className={`${field} w-24`}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
}

function PointsInput({
  value,
  onChange,
}: {
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const [text, setText] = useState(value.join(", "));
  return (
    <label className="flex flex-col gap-1 text-sm">
      Points by rank (rank 1 first; used when a board has no points of its own)
      <input
        className={field}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const numbers = text
            .split(/[\s,]+/)
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0)
            .slice(0, LIMITS.maxAnswers);
          if (numbers.length > 0) onChange(numbers);
          else setText(value.join(", "));
        }}
      />
    </label>
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
      className="flex flex-col gap-2 rounded border border-white/20 p-3"
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
              <span className="w-20 text-sm text-white/70">
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
      <p className="text-white/80">
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
      {problem && <p className="text-red-300">{problem}</p>}
    </div>
  );
}

function Preflight({
  check,
}: {
  check: { blocking: string[]; warnings: string[] };
}) {
  if (check.blocking.length === 0 && check.warnings.length === 0) {
    return <p className="text-sm text-green-300">Ready to start.</p>;
  }
  return (
    <div data-testid="preflight" className="flex flex-col gap-2 text-sm">
      {check.blocking.length > 0 && (
        <div>
          <p className="font-semibold text-red-300">Fix before starting</p>
          <ul className="list-disc pl-5">
            {check.blocking.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {check.warnings.length > 0 && (
        <div>
          <p className="font-semibold text-amber-300">Worth knowing</p>
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
  const send = (action: Parameters<typeof act.mutate>[0]["action"]) =>
    act.mutate({ action, expectedStep: step(), requestId: newRequestId() });
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
        <p className="text-xs text-white/70">
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
        className="text-sm text-red-300"
      />

      {running && (
        <div className="flex flex-wrap gap-2 border-t border-white/20 pt-3">
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
        <p className="text-xs text-white/70">
          Undo takes back the points of the last action. Answers already shown
          stay shown, for 0 points.
        </p>
      )}
      {view.status === "ended" && (
        <p className="text-sm">
          Ranked Answers has ended. Use the Game Controls tab for buzzers and
          scores.
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
  ) => void;
}) {
  const board = view.state!.board!;
  const rules = view.content!.rules;
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [first, setFirst] = useState<string>(board.faceOffTeams[0] ?? "");
  const step = useRef(view.step);
  // Clear the form whenever the board moves on.
  useEffect(() => {
    if (step.current !== view.step) {
      step.current = view.step;
      setPicks({});
    }
  }, [view.step]);
  const pick = (team: string) => (v: string) =>
    setPicks((p) => ({ ...p, [team]: v }));
  const name = (id: string | null) => (id ? (names[id] ?? "Team") : "Team");

  const answerButtons = (
    onPick: (answerId: string | null) => void,
    wrongLabel: string,
  ) => (
    <div className="flex flex-wrap gap-2">
      {hidden.map((a) => (
        <Button
          key={a.id}
          disabled={disabled}
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => onPick(a.id)}
        >
          #{a.rank} {a.text}
        </Button>
      ))}
      <Button
        variant="destructive"
        disabled={disabled}
        onClick={() => onPick(null)}
      >
        {wrongLabel}
      </Button>
    </div>
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
      const stealers = board.teams.filter((t) => t !== board.control);
      const ready = stealers.every((t) => picks[t]);
      return (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">
            Steal for {board.bank} points:{" "}
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
          </p>
          {answerButtons(
            (answerId) => send({ type: "answer", answerId }),
            "✕ Wrong / pass",
          )}
          {closeButton}
        </div>
      );
    }
    case "allPlay": {
      const ready = board.teams.every((t) => picks[t]);
      return (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">
            Round {board.round + 1} of {rules.allPlayRounds}: record each
            team&apos;s answer, then reveal.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {board.teams.map((t) => (
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
                    board.teams.map((t) => [t, asAnswer(picks[t]!)]),
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
    default:
      return null;
  }
}
