"use client";

import { useState, useEffect } from "react";
import { BuzzerState, type GameTeam } from "@prisma/client";

import { api } from "@/trpc/react";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/app/_components/ui/toggle-group";

import { GenericCard } from "@/app/_components/GenericCard";
import { Input } from "@/app/_components/ui/input";
import { Button } from "@/app/_components/ui/button";
import { logger } from "@/utils/logger";

import { DataTable } from "./GameTeamsTable";
import { type GameTeamDataTableRow, columns } from "./gameTeamTableColumns";

export function GameAdminScoreboardAdvancedControl({
  gameTeams,
}: {
  gameTeams: Array<
    Pick<GameTeam, "id" | "name" | "index" | "buzzerState"> & { score: number }
  >;
}) {
  logger.debug(`GameAdminScoreboardControl`);
  const [score, setScore] = useState<number>(0);
  const [selectedGameTeams, setSelectedGameTeams] = useState<
    Record<GameTeam["id"], boolean>
  >({});

  const addScoreMutation = api.gameAdmin.addScore.useMutation();
  const setScoreMutation = api.gameAdmin.setScore.useMutation();
  const undoScoreMutation = api.gameAdmin.undoScore.useMutation();
  const redoScoreMutation = api.gameAdmin.redoScore.useMutation();

  if (!Array.isArray(gameTeams) || gameTeams.length === 0) {
    return undefined;
  }

  const getScorePayload = (): Record<GameTeam["id"], number> => {
    return Object.fromEntries(
      Object.entries(selectedGameTeams)
        .map(([gameTeamId, shouldAffect]) => [
          gameTeamId,
          shouldAffect ? score : undefined,
        ])
        .filter(([, score]) => typeof score === "number"),
    );
  };

  const numAffectedTeams = Object.entries(selectedGameTeams).filter(
    ([, shouldAffect]) => shouldAffect,
  ).length;
  const isScoreReady = numAffectedTeams > 0 && score;

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
              } as GameTeamDataTableRow;
            })}
            onChange={setSelectedGameTeams}
          />
          <Input
            type="number"
            placeholder="Enter Score"
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
            className="mb-4 rounded border border-gray-300 p-2"
          />
          <Button
            onClick={() => {
              if (isScoreReady) {
                addScoreMutation.mutate(getScorePayload());
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
                const payloadEntries = Object.entries(getScorePayload());
                addScoreMutation.mutate(
                  Object.fromEntries(
                    payloadEntries.map(([teamId, score]) => [teamId, -score]),
                  ),
                );
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
                setScoreMutation.mutate(getScorePayload());
              }
            }}
            disabled={!isScoreReady}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Set
          </Button>
          <Button
            onClick={() => undoScoreMutation.mutate()}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Undo
          </Button>
          <Button
            onClick={() => redoScoreMutation.mutate()}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Redo
          </Button>
        </div>
      }
    />
  );
}
