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

function GameTeamToggleGroup({
  gameTeams,
  onChange,
}: {
  gameTeams: Pick<GameTeam, "id" | "name" | "index" | "buzzerState">[];
  onChange: (selectedTeams: Record<GameTeam["id"], boolean>) => void;
}) {
  const [selectedTeams, setSelectedTeams] = useState<GameTeam["id"][]>([]);

  useEffect(() => {
    const newSelectedTeams = Object.fromEntries(
      selectedTeams.map((gameTeamId) => [gameTeamId, true]),
    );

    onChange(newSelectedTeams);
  }, [selectedTeams]);

  const onSelected = () => {
    setSelectedTeams(
      gameTeams
        .filter((team) => team.buzzerState === BuzzerState.selected)
        .map((item) => item.id),
    );
  };
  const onRejected = () => {
    setSelectedTeams(
      gameTeams
        .filter((team) => team.buzzerState === BuzzerState.rejected)
        .map((item) => item.id),
    );
  };
  const onClear = () => {
    setSelectedTeams([]);
  };

  return (
    <div>
      <div>
        <Button
          onClick={onSelected}
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Selected
        </Button>
        <Button
          onClick={onRejected}
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Rejected
        </Button>
        <Button
          onClick={onClear}
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
        >
          Clear
        </Button>
      </div>
      <div>
        <ToggleGroup
          type="multiple"
          value={selectedTeams}
          onValueChange={setSelectedTeams}
        >
          {gameTeams.map((team) => (
            <ToggleGroupItem
              key={team.id}
              value={team.id}
              aria-label={`Select ${team.name}`}
            >
              Team {team.index}: {team.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}

export function GameAdminScoreboardAdvancedControl({
  gameTeams,
}: {
  gameTeams: Pick<GameTeam, "id" | "name" | "index" | "buzzerState">[];
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

  const getScorePayload = () => {
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
          <GameTeamToggleGroup
            gameTeams={gameTeams}
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
