"use client";

import { buzzerStatus } from "@/app/_components/client/PlayerStatus/buzzerStatus";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import { api } from "@/trpc/react";
import { newRequestId } from "@/utils/requestId";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";

const TONE_CLASS = {
  ready: "bg-green-600 hover:bg-green-700",
  won: "bg-amber-500",
  waiting: "bg-slate-500",
  blocked: "bg-slate-500",
} as const;

/**
 * The player's buzzer. Its label always says why it can or cannot be
 * pressed. While live updates are reconnecting the button stays enabled, so
 * stale state never blocks a real buzz; the server decides.
 */
export function GameBuzzerTab({ gameUserId }: { gameUserId: string }) {
  const live = useLiveGameState();
  const buzzIn = api.gameUser.buzzIn.useMutation();

  if (!live.data) return null;
  const status = buzzerStatus(live.data, gameUserId);
  const liveHealthy = live.status === "pending";
  const disabled = buzzIn.isPending || (liveHealthy && !status.canBuzz);

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={() => {
          buzzIn.reset();
          buzzIn.mutate({ requestId: newRequestId() });
        }}
        disabled={disabled}
        aria-describedby="buzzer-status"
        className={`h-40 w-full text-2xl text-white ${TONE_CLASS[status.tone]}`}
      >
        {buzzIn.isPending ? "Sending…" : "Buzz"}
      </Button>
      <p
        id="buzzer-status"
        role="status"
        className="text-center text-lg font-medium"
      >
        {status.message}
      </p>
      <ErrorNotice
        error={buzzIn.error}
        className="text-center text-sm text-red-300"
      />
    </div>
  );
}
