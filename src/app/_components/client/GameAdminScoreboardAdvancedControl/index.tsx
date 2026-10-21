"use client";

import { useState } from "react";
import { type GameTeam } from "@prisma/client";

import { api } from "@/trpc/react";

import { GenericCard } from "@/app/_components/GenericCard";
import { Input } from "@/app/_components/ui/input";
import { Button } from "@/app/_components/ui/button";
import { logger } from "@/logger";
import { newRequestId } from "@/utils/requestId";

import { DataTable } from "./GameTeamsTable";
import { columns } from "./gameTeamTableColumns";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";

export function GameAdminScoreboardAdvancedControl({
  gameTeams,
  embedded = false,
}: {
  gameTeams: Array<
    Pick<GameTeam, "id" | "name" | "index" | "buzzerState"> & { score: number }
  >;
  /** Inside another panel: no card of its own, and no undo/redo buttons. */
  embedded?: boolean;
}) {
  logger.debug(`GameAdminScoreboardControl`);
  // Kept as text so "0", an empty field and a lone "-" are distinguishable.
  const [scoreText, setScoreText] = useState("0");
  const [selectedGameTeams, setSelectedGameTeams] = useState<
    Record<GameTeam["id"], boolean>
  >({});

  const addScoreMutation = api.gameAdmin.addScore.useMutation();
  const setScoreMutation = api.gameAdmin.setScore.useMutation();
  const undoScoreMutation = api.gameAdmin.undoScore.useMutation();
  const redoScoreMutation = api.gameAdmin.redoScore.useMutation();
  const mutations = [
    addScoreMutation,
    setScoreMutation,
    undoScoreMutation,
    redoScoreMutation,
  ];
  const isSaving = mutations.some((m) => m.isPending);
  const lastError = mutations.find((m) => m.isError)?.error;

  if (!Array.isArray(gameTeams) || gameTeams.length === 0) {
    return undefined;
  }

  const trimmed = scoreText.trim();
  const score = /^-?\d+$/.test(trimmed) ? Number(trimmed) : undefined;

  const changesFor = (amount: number): Record<GameTeam["id"], number> =>
    Object.fromEntries(
      Object.entries(selectedGameTeams)
        .filter(([, shouldAffect]) => shouldAffect)
        .map(([gameTeamId]) => [gameTeamId, amount]),
    );

  const numAffectedTeams = Object.keys(changesFor(0)).length;
  const isScoreReady = numAffectedTeams > 0 && score !== undefined && !isSaving;
  const disabledReason =
    numAffectedTeams === 0
      ? "Select at least one team."
      : score === undefined
        ? "Enter a whole number."
        : undefined;

  const reset = () => mutations.forEach((m) => m.reset());

  const content = (
    <div>
      <DataTable
        columns={columns}
        data={gameTeams.map((team) => {
          return {
            id: team.id,
            name: team.name,
            index: team.index,
            buzzerState: team.buzzerState,
            score: team.score,
          };
        })}
        onChange={setSelectedGameTeams}
      />
      <Input
        type="text"
        inputMode="numeric"
        placeholder="Enter Score"
        aria-label="Score"
        value={scoreText}
        onChange={(e) => setScoreText(e.target.value)}
        className="field mb-2 p-2"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            if (isScoreReady) {
              reset();
              addScoreMutation.mutate({
                requestId: newRequestId(),
                changes: changesFor(score),
              });
            }
          }}
          disabled={!isScoreReady}
        >
          Add
        </Button>
        <Button
          onClick={() => {
            if (isScoreReady) {
              reset();
              addScoreMutation.mutate({
                requestId: newRequestId(),
                changes: changesFor(-score),
              });
            }
          }}
          disabled={!isScoreReady}
          variant="secondary"
        >
          Subtract
        </Button>
        <Button
          onClick={() => {
            if (isScoreReady) {
              reset();
              setScoreMutation.mutate({
                requestId: newRequestId(),
                changes: changesFor(score),
              });
            }
          }}
          disabled={!isScoreReady}
          variant="secondary"
        >
          Set
        </Button>
        {!embedded && (
          <>
            <Button
              onClick={() => {
                reset();
                undoScoreMutation.mutate({ requestId: newRequestId() });
              }}
              disabled={isSaving}
              variant="outline"
            >
              Undo
            </Button>
            <Button
              onClick={() => {
                reset();
                redoScoreMutation.mutate({ requestId: newRequestId() });
              }}
              disabled={isSaving}
              variant="outline"
            >
              Redo
            </Button>
          </>
        )}
      </div>
      {disabledReason && (
        <p className="text-muted-foreground mt-2 text-sm">{disabledReason}</p>
      )}
      <ErrorNotice
        error={lastError}
        className="text-destructive mt-2 text-sm"
      />
    </div>
  );
  if (embedded) return content;
  return (
    <GenericCard
      title="Scores"
      description="Tick teams, enter points, then add, subtract or set them."
      content={content}
    />
  );
}
