"use client";

import { api } from "@/trpc/react";

import { Button } from "@/app/_components/ui/button";
import { GenericCard } from "@/app/_components/GenericCard";
import { logger } from "@/logger";

export function GameAdminBuzzerControl() {
  logger.debug(`GameAdminBuzzerControl`);

  const startBuzzerMutation = api.gameAdmin.startBuzzer.useMutation();
  const pauseBuzzerMutation = api.gameAdmin.pauseBuzzer.useMutation();
  const resetBuzzerMutation = api.gameAdmin.resetBuzzer.useMutation();

  const isPending =
    startBuzzerMutation.isPending ||
    pauseBuzzerMutation.isPending ||
    resetBuzzerMutation.isPending;

  return (
    <GenericCard
      title="Buzzer"
      description="Open the buzzer for a question, pause it, or clear it for the next one."
      content={
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => startBuzzerMutation.mutate()}
            disabled={isPending}
            size="lg"
          >
            Start Buzzer
          </Button>
          <Button
            onClick={() => pauseBuzzerMutation.mutate()}
            disabled={isPending}
            size="lg"
            variant="secondary"
          >
            Pause Buzzer
          </Button>
          <Button
            onClick={() => resetBuzzerMutation.mutate()}
            disabled={isPending}
            size="lg"
            variant="outline"
          >
            Reset Buzzer
          </Button>
        </div>
      }
    />
  );
}
