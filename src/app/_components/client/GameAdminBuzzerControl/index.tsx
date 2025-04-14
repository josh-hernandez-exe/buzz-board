"use client";

import { api } from "@/trpc/react";

import { Button } from "@/app/_components/ui/button";
import { GenericCard } from "@/app/_components/GenericCard";
import { logger } from "@/utils/logger";

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
      title="Admin Buzzer Control"
      description="Control the buzzer state"
      content={
        <div>
          <Button
            onClick={() => startBuzzerMutation.mutate()}
            disabled={isPending}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Start Buzzer
          </Button>
          <Button
            onClick={() => pauseBuzzerMutation.mutate()}
            disabled={isPending}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Pause Buzzer
          </Button>
          <Button
            onClick={() => resetBuzzerMutation.mutate()}
            disabled={isPending}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Reset Buzzer
          </Button>
        </div>
      }
    />
  );
}
