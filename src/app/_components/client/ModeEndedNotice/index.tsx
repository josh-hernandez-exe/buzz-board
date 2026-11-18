"use client";

import { Notice } from "@/app/_components/ui/page";
import type { PublicGameModeView } from "@/utils/modes";
import { MODE_LABEL } from "@/utils/modes";

/**
 * After "Use basic controls" (W23): tell players and the audience why the
 * board went away. Scores and teams are unchanged.
 */
export function ModeEndedNotice({
  mode,
  gameFinished,
  large = false,
}: {
  mode: PublicGameModeView | null | undefined;
  gameFinished: boolean;
  large?: boolean;
}) {
  if (mode?.status !== "ended" || gameFinished) return null;
  return (
    <Notice tone="info" className={large ? "text-center text-xl" : undefined}>
      <span data-testid="mode-ended">
        {MODE_LABEL[mode.kind]} has ended. The game carries on with the buzzer;
        scores are kept.
      </span>
    </Notice>
  );
}
