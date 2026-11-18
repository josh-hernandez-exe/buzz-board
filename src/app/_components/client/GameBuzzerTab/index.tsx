"use client";

import {
  buzzerStatus,
  noBuzzerTurn,
} from "@/app/_components/client/PlayerStatus/buzzerStatus";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import { api } from "@/trpc/react";
import { newRequestId } from "@/utils/requestId";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";

// Disabled states stay fully opaque: each has its own look and a reason
// underneath, so the buzzer never looks broken.
const TONE_CLASS = {
  ready: "bg-primary text-primary-foreground hover:bg-primary-hover",
  won: "bg-success text-success-foreground ring-success/40 ring-8 disabled:opacity-100",
  waiting:
    "bg-muted text-muted-foreground border-border border-2 disabled:opacity-100",
  blocked:
    "bg-muted text-muted-foreground border-border border-2 border-dashed disabled:opacity-100",
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
  const turn = noBuzzerTurn(live.data, gameUserId);
  if (turn) {
    return (
      <p
        role="status"
        data-testid="turn-card"
        className={`font-display rounded-2xl p-6 text-center text-2xl ${
          turn.mine
            ? "bg-success text-success-foreground ring-success/40 ring-8"
            : "bg-muted text-muted-foreground border-border border-2"
        }`}
      >
        {turn.message}
      </p>
    );
  }
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
        className={`font-display h-40 w-full rounded-2xl text-3xl shadow-lg ${TONE_CLASS[status.tone]}`}
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
        className="text-destructive text-center text-sm"
      />
    </div>
  );
}
