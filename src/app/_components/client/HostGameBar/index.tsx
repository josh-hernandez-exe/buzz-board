"use client";

import { useState } from "react";
import { GameStatus } from "@prisma/client";

import { joinUrl } from "@/app/_components/client/JoinQrCode";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import { StatusPill } from "@/app/_components/ui/page";
import { ROLE_LABEL, can, type StaffRoleName } from "@/utils/capabilities";
import { STATUS_LABEL } from "@/utils/gameRules";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState<boolean | "failed">(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => setCopied("failed"),
        );
        setTimeout(() => setCopied(false), 2_000);
      }}
    >
      {copied === true
        ? "Copied"
        : copied === "failed"
          ? "Copy failed: select the link"
          : label}
    </Button>
  );
}

/**
 * Always at the top of the host desk: which game this is, its status, and
 * what players need to join. Kept compact so the controls stay in view on a
 * tablet.
 */
export function HostGameBar({ staffRole }: { staffRole: StaffRoleName }) {
  const { data } = useLiveGameState();
  if (!data) return null;
  const { game } = data;
  const runsGame = can(staffRole, "runGame");
  const tone =
    game.status === GameStatus.running
      ? "success"
      : game.status === GameStatus.lobby
        ? "warning"
        : "neutral";

  return (
    <header
      aria-label="Game"
      className="bg-surface border-border flex flex-col gap-3 rounded-xl border p-3 shadow-sm sm:p-4 lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display min-w-0 text-xl font-extrabold break-words sm:text-2xl">
            {game.name}
          </h1>
          <StatusPill tone={tone} data-testid="game-status">
            {STATUS_LABEL[game.status]}
          </StatusPill>
        </div>
        <p className="text-muted-foreground text-sm" data-testid="my-role">
          You&apos;re the <strong>{ROLE_LABEL[staffRole]}</strong> of this game.
          {!runsGame &&
            " You can rename, move and remove players. The owner and co-hosts run the buzzer and scores."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-1 flex items-baseline gap-2">
          <span className="text-muted-foreground text-sm">Join code</span>
          <strong
            data-testid="join-code"
            className="font-mono text-2xl tracking-widest"
          >
            {game.code}
          </strong>
        </p>
        <CopyButton text={joinUrl(game.code)} label="Copy join link" />
        <Button variant="secondary" size="sm" asChild>
          <a
            href={`/game/${game.id}/scoreboard/public`}
            target="_blank"
            rel="noreferrer"
          >
            Open audience display
          </a>
        </Button>
      </div>
    </header>
  );
}
