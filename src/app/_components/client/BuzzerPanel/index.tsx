"use client";

import { useEffect, useState } from "react";

import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import { Panel, StatusPill } from "@/app/_components/ui/page";
import { api } from "@/trpc/react";
import type { PrivateGameState } from "@/types";
import { newRequestId } from "@/utils/requestId";

type Queue = PrivateGameState["buzzQueue"];
type Entry = Queue[number];

const STATUS_LABEL: Record<Entry["status"], string> = {
  answering: "Answering",
  waiting: "Waiting",
  correct: "Correct",
  wrong: "Wrong",
  skipped: "Skipped",
};
const STATUS_TONE = {
  answering: "info",
  waiting: "neutral",
  correct: "success",
  wrong: "danger",
  skipped: "neutral",
} as const;

/**
 * The host's buzzer: what's happening now, the actions that make sense now,
 * one-tap points for whoever holds the buzz, and undo/redo of every buzzer
 * action. Works in first-buzz and queue modes.
 */
export function BuzzerPanel() {
  const { data } = useLiveGameState();
  const utils = api.useUtils();
  const history = api.gameAdmin.buzzer.history.useQuery();
  const buzzerKey = data
    ? JSON.stringify([
        data.game.isBuzzerListening,
        data.game.buzzerMode,
        data.buzzWinner,
        data.buzzQueue.map((e) => e.status),
      ])
    : "";
  // Another host acting changes the buzzer: refresh the undo labels.
  useEffect(() => {
    void utils.gameAdmin.buzzer.history.invalidate();
  }, [buzzerKey, utils]);

  const refresh = () => utils.gameAdmin.buzzer.history.invalidate();
  const open = api.gameAdmin.startBuzzer.useMutation({ onSuccess: refresh });
  const close = api.gameAdmin.pauseBuzzer.useMutation({ onSuccess: refresh });
  const next = api.gameAdmin.resetBuzzer.useMutation({ onSuccess: refresh });
  const judge = api.gameAdmin.buzzer.judge.useMutation({ onSuccess: refresh });
  const undo = api.gameAdmin.buzzer.undo.useMutation({ onSuccess: refresh });
  const redo = api.gameAdmin.buzzer.redo.useMutation({ onSuccess: refresh });
  const setMode = api.gameAdmin.buzzer.setMode.useMutation({
    onSuccess: refresh,
  });
  const busy =
    setMode.isPending ||
    open.isPending ||
    close.isPending ||
    next.isPending ||
    judge.isPending ||
    undo.isPending ||
    redo.isPending;
  const error =
    setMode.error ??
    open.error ??
    close.error ??
    next.error ??
    judge.error ??
    undo.error ??
    redo.error;

  if (!data) return null;
  const { game, buzzWinner, buzzQueue } = data;
  const finished = game.status === "finished";
  const queueMode = game.buzzerMode === "queue";
  const teamName = (id: string) =>
    data.gameTeams.find((t) => t.id === id)?.name ?? "A removed team";
  const playerName = (id: string | null) =>
    id ? data.gameUsers[id]?.name : undefined;
  const who = (teamId: string, userId: string | null) => {
    const player = playerName(userId);
    if (game.format === "individual") return player ?? teamName(teamId);
    return player ? `${player} (${teamName(teamId)})` : teamName(teamId);
  };

  const winner = !queueMode ? buzzWinner : null;
  const answering = buzzQueue.find((e) => e.status === "answering");
  const correct = buzzQueue.find((e) => e.status === "correct");
  const lastUndo = history.data?.past[0];
  const lastRedo = history.data?.future[0];

  let headline: string;
  if (finished) headline = "The game has finished.";
  else if (winner)
    headline = `${who(winner.gameTeamId, winner.gameUserId)} buzzed first!`;
  else if (correct)
    headline = `${who(correct.gameTeamId, correct.gameUserId)} got it!`;
  else if (answering)
    headline = `${who(answering.gameTeamId, answering.gameUserId)} is answering`;
  else if (game.isBuzzerListening)
    headline = queueMode
      ? "Buzzer open: buzzes join the queue"
      : "Buzzer open: waiting for a buzz";
  else headline = "Buzzer closed";

  const holder = winner ?? answering ?? correct;

  return (
    <Panel
      aria-label="Buzzer"
      title="Buzzer"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            Buzzing
            <select
              aria-label="Buzzing mode"
              className="field px-2 py-1 text-sm"
              value={game.buzzerMode}
              disabled={busy || finished || game.isBuzzerListening}
              title={
                game.isBuzzerListening
                  ? "Close the buzzer to change how buzzing works."
                  : undefined
              }
              onChange={(e) =>
                setMode.mutate({
                  mode: e.target.value === "queue" ? "queue" : "first",
                })
              }
            >
              <option value="first">First buzz wins</option>
              <option value="queue">Queue: everyone lines up</option>
            </select>
          </label>
          <StatusPill
            tone={game.isBuzzerListening ? "success" : "neutral"}
            data-testid="buzzer-open-state"
          >
            {game.isBuzzerListening ? "Open" : "Closed"}
          </StatusPill>
        </div>
      }
    >
      <p
        role="status"
        data-testid="buzzer-headline"
        className="font-display text-2xl font-extrabold"
      >
        {headline}
      </p>

      {!finished && (
        <div className="flex flex-wrap gap-2">
          {game.isBuzzerListening ? (
            <Button
              size="lg"
              variant="secondary"
              disabled={busy}
              onClick={() => close.mutate()}
            >
              Close buzzer
            </Button>
          ) : winner ? (
            <Button size="lg" disabled={busy} onClick={() => open.mutate()}>
              Wrong: let others buzz
            </Button>
          ) : (
            <Button size="lg" disabled={busy} onClick={() => open.mutate()}>
              {correct
                ? "Open buzzer for a new question"
                : queueMode && buzzQueue.length > 0
                  ? "Reopen buzzer"
                  : "Open buzzer"}
            </Button>
          )}
          <Button
            size="lg"
            variant="outline"
            disabled={busy}
            onClick={() => next.mutate()}
          >
            Next question
          </Button>
        </div>
      )}

      {holder && (
        <AwardPoints
          key={holder.gameTeamId}
          teamId={holder.gameTeamId}
          teamName={teamName(holder.gameTeamId)}
        />
      )}

      {queueMode && (
        <QueueList
          queue={buzzQueue}
          who={who}
          busy={busy || finished}
          onJudge={(entryId, verdict) => judge.mutate({ entryId, verdict })}
        />
      )}

      <ErrorNotice error={error} />

      <div className="border-border flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !lastUndo}
          onClick={() => undo.mutate()}
          aria-label={lastUndo ? `Undo: ${lastUndo.label}` : "Undo"}
        >
          ↶ Undo{lastUndo ? `: ${lastUndo.label}` : ""}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !lastRedo}
          onClick={() => redo.mutate()}
          aria-label={lastRedo ? `Redo: ${lastRedo.label}` : "Redo"}
        >
          ↷ Redo{lastRedo ? `: ${lastRedo.label}` : ""}
        </Button>
        {history.data && history.data.past.length > 0 && (
          <details className="text-muted-foreground w-full text-sm">
            <summary className="cursor-pointer">Recent buzzer actions</summary>
            <ol className="mt-1 flex flex-col gap-0.5">
              {history.data.past.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex gap-2">
                  <time className="tabular-nums">
                    {new Date(e.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                  {e.label}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </Panel>
  );
}

function QueueList({
  queue,
  who,
  busy,
  onJudge,
}: {
  queue: Queue;
  who: (teamId: string, userId: string) => string;
  busy: boolean;
  onJudge: (entryId: string, verdict: "correct" | "wrong" | "skip") => void;
}) {
  if (queue.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nobody has buzzed this question yet.
      </p>
    );
  }
  return (
    <ol aria-label="Buzz queue" className="flex flex-col gap-2">
      {queue.map((entry) => {
        const name = who(entry.gameTeamId, entry.gameUserId);
        const answering = entry.status === "answering";
        return (
          <li
            key={entry.id}
            data-testid="queue-entry"
            className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${
              answering ? "border-info bg-accent-soft" : "border-border"
            } ${entry.status === "skipped" ? "opacity-60" : ""}`}
          >
            <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold">
              {entry.position}
            </span>
            <span className="min-w-0 flex-1 font-semibold break-words">
              {name}
            </span>
            <StatusPill tone={STATUS_TONE[entry.status]}>
              {STATUS_LABEL[entry.status]}
            </StatusPill>
            {answering && (
              <span className="grid w-full grid-cols-3 gap-2">
                <Button
                  className="bg-success text-success-foreground hover:bg-success/90"
                  disabled={busy}
                  aria-label={`Correct: ${name}`}
                  onClick={() => onJudge(entry.id, "correct")}
                >
                  ✓ Correct
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  aria-label={`Wrong: ${name}`}
                  onClick={() => onJudge(entry.id, "wrong")}
                >
                  ✕ Wrong
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={`Skip ${name} (no lockout)`}
                  onClick={() => onJudge(entry.id, "skip")}
                >
                  Skip
                </Button>
              </span>
            )}
            {entry.status === "waiting" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Remove ${name} from the queue`}
                onClick={() => onJudge(entry.id, "skip")}
              >
                Remove
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** One tap to add points to whoever holds the buzz. */
function AwardPoints({
  teamId,
  teamName,
}: {
  teamId: string;
  teamName: string;
}) {
  const [amount, setAmount] = useState(1);
  const [lastAwarded, setLastAwarded] = useState<string | null>(null);
  const add = api.gameAdmin.addScore.useMutation();
  return (
    <div className="bg-surface-sunken flex flex-wrap items-center gap-2 rounded-lg p-2">
      <label className="flex items-center gap-2 text-sm">
        Points
        <input
          type="number"
          inputMode="numeric"
          className="field w-20 px-2 py-1 text-base"
          value={amount}
          min={1}
          onChange={(e) =>
            setAmount(Math.max(1, Math.round(Number(e.target.value)) || 1))
          }
        />
      </label>
      <Button
        disabled={add.isPending}
        onClick={() => {
          const sent = amount;
          add.mutate(
            { requestId: newRequestId(), changes: { [teamId]: sent } },
            { onSuccess: () => setLastAwarded(`+${sent} to ${teamName}`) },
          );
        }}
      >
        Award {amount} to {teamName}
      </Button>
      {lastAwarded && !add.isPending && (
        <span role="status" className="text-muted-foreground text-sm">
          Added {lastAwarded}.
        </span>
      )}
      <ErrorNotice error={add.error} />
    </div>
  );
}
