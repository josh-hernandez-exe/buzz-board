"use client";

import { useState } from "react";
import type { GameTeam } from "@prisma/client";

import { api } from "@/trpc/react";

import { GameTeamSelectionDropDown } from "@/app/_components/client/GameTeamSelectionDropDown";
import { GenericCard } from "@/app/_components/GenericCard";
import { Input } from "@/app/_components/ui/input";
import { Button } from "@/app/_components/ui/button";
import { logger } from "@/utils/logger";

export function GameAdminScoreboardControl({
  gameTeams,
}: {
  gameTeams: GameTeam[];
}) {
  logger.debug(`GameAdminScoreboardControl`);
  const utils = api.useUtils();
  const [score, setScore] = useState<number>(0);
  const [selectedGameTeam, setSelectedGameTeam] = useState<GameTeam | null>(
    null,
  );

  const addScoreMutation = api.gameAdmin.addScore.useMutation({
    onSuccess: async () => {
      await utils.gameAdmin.getAllInfo.invalidate();
    },
  });
  const setScoreMutation = api.gameAdmin.setScore.useMutation({
    onSuccess: async () => {
      await utils.gameAdmin.getAllInfo.invalidate();
    },
  });
  const undoScoreMutation = api.gameAdmin.undoScore.useMutation({
    onSuccess: async () => {
      await utils.gameAdmin.getAllInfo.invalidate();
    },
  });
  const redoScoreMutation = api.gameAdmin.redoScore.useMutation({
    onSuccess: async () => {
      await utils.gameAdmin.getAllInfo.invalidate();
    },
  });

  if (!Array.isArray(gameTeams) || gameTeams.length === 0) {
    return undefined;
  }

  const isScoreReady = selectedGameTeam && score;

  return (
    <GenericCard
      title="Admin Scoreboard Control"
      description="Update the score for a team"
      content={
        <div>
          <GameTeamSelectionDropDown
            gameTeams={gameTeams}
            onChange={setSelectedGameTeam}
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
                addScoreMutation.mutate({
                  [selectedGameTeam.id]: score,
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
                setScoreMutation.mutate({
                  [selectedGameTeam.id]: score,
                });
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
