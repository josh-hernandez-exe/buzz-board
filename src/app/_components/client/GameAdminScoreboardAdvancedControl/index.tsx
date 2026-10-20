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

export function GameAdminScoreboardAdvancedControl({
  gameTeams,
}: {
  gameTeams: Array<
    Pick<GameTeam, "id" | "name" | "index" | "buzzerState"> & { score: number }
  >;
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
  const lastError = mutations.find((m) => m.isError)?.error?.message;

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

  return (
    <GenericCard
      title="Admin Scoreboard Advanced Controls"
      description="Update the score for a team"
      content={
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
            className="mb-4 rounded border border-gray-300 p-2"
          />
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
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
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
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
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
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Set
          </Button>
          <Button
            onClick={() => {
              reset();
              undoScoreMutation.mutate({ requestId: newRequestId() });
            }}
            disabled={isSaving}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Undo
          </Button>
          <Button
            onClick={() => {
              reset();
              redoScoreMutation.mutate({ requestId: newRequestId() });
            }}
            disabled={isSaving}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Redo
          </Button>
          {disabledReason && (
            <p className="mt-2 text-sm text-gray-600">{disabledReason}</p>
          )}
          {lastError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {lastError}
            </p>
          )}
        </div>
      }
    />
  );
}
