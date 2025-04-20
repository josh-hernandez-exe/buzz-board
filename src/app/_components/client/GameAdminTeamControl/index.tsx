"use client";

import { api } from "@/trpc/react";

import { Button } from "@/app/_components/ui/button";
import { GenericCard } from "@/app/_components/GenericCard";
import { logger } from "@/logger";

export function GameAdminTeamControl() {
  logger.debug(`GameAdminTeamControl`);

  const addTeamMutation = api.gameAdmin.addTeam.useMutation();

  return (
    <GenericCard
      title="Admin Team Control"
      description="Control team creation"
      content={
        <div>
          <Button
            onClick={() => addTeamMutation.mutate()}
            disabled={addTeamMutation.isPending}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Add Team
          </Button>
        </div>
      }
    />
  );
}
