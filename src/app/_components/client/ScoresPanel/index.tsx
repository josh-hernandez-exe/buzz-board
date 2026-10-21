"use client";

import { useState } from "react";

import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { GameAdminScoreboardAdvancedControl } from "@/app/_components/client/GameAdminScoreboardAdvancedControl";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import { Panel } from "@/app/_components/ui/page";
import { api } from "@/trpc/react";
import { newRequestId } from "@/utils/requestId";

/**
 * Scores at a glance, with one-tap add and subtract per team, score undo
 * and redo, and the multi-team tool for setting several scores at once.
 */
export function ScoresPanel() {
  const { data } = useLiveGameState();
  const [amount, setAmount] = useState(1);
  const add = api.gameAdmin.addScore.useMutation();
  const undo = api.gameAdmin.undoScore.useMutation();
  const redo = api.gameAdmin.redoScore.useMutation();
  if (!data) return null;
  const finished = data.game.status === "finished";
  const teams = [...data.gameTeams].sort((a, b) => a.index - b.index);
  const leader = Math.max(...teams.map((t) => t.score));
  const busy = add.isPending || undo.isPending || redo.isPending;
  const change = (teamId: string, delta: number) =>
    add.mutate({ requestId: newRequestId(), changes: { [teamId]: delta } });

  return (
    <Panel
      aria-label="Scores"
      title="Scores"
      actions={
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || finished}
            onClick={() => undo.mutate({ requestId: newRequestId() })}
          >
            ↶ Undo score
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || finished}
            onClick={() => redo.mutate({ requestId: newRequestId() })}
          >
            ↷ Redo
          </Button>
        </div>
      }
    >
      <label className="flex items-center gap-2 text-sm">
        Points per tap
        <input
          type="number"
          inputMode="numeric"
          aria-label="Points per tap"
          className="field w-20 px-2 py-1 text-base"
          min={1}
          value={amount}
          onChange={(e) =>
            setAmount(Math.max(1, Math.round(Number(e.target.value)) || 1))
          }
        />
      </label>
      {teams.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Teams appear here once the game has some.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {teams.map((team) => (
            <li
              key={team.id}
              data-testid="score-row"
              className="bg-surface-sunken flex items-center gap-2 rounded-lg px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate font-semibold">
                {team.name}
                {team.score === leader && leader > 0 && (
                  <span className="text-warning-text ml-1" aria-label="leading">
                    ★
                  </span>
                )}
              </span>
              <span className="font-display min-w-12 text-right text-2xl font-extrabold tabular-nums">
                {team.score}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || finished}
                aria-label={`Subtract ${amount} from ${team.name}`}
                onClick={() => change(team.id, -amount)}
              >
                −{amount}
              </Button>
              <Button
                size="sm"
                disabled={busy || finished}
                aria-label={`Add ${amount} to ${team.name}`}
                onClick={() => change(team.id, amount)}
              >
                +{amount}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice error={add.error ?? undo.error ?? redo.error} />
      <details className="border-border rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
          More score tools: several teams at once, set exact scores
        </summary>
        <div className="p-2">
          <GameAdminScoreboardAdvancedControl
            gameTeams={teams.map(({ gameUsers: _u, ...t }) => t)}
            embedded
          />
        </div>
      </details>
    </Panel>
  );
}
