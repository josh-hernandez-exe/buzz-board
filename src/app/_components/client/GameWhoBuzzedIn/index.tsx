"use client";

import { GameFormat } from "@prisma/client";

import { GameUserAvatar } from "@/app/_components/client/GameUserAvatar";
import { noBuzzerTurn } from "@/app/_components/client/PlayerStatus/buzzerStatus";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Panel, StatusPill, type Tone } from "@/app/_components/ui/page";
import { api } from "@/trpc/react";
import type { PrivateGameState } from "@/types";
import { cn } from "@/app/_lib/utils";

type Entry = PrivateGameState["buzzQueue"][number];

const QUEUE_STATUS: Record<Entry["status"], [string, Tone]> = {
  answering: ["Answering", "info"],
  waiting: ["Waiting", "neutral"],
  correct: ["Correct", "success"],
  wrong: ["Wrong", "danger"],
  skipped: ["Skipped", "neutral"],
};

/**
 * Who has buzzed: the winner in first-buzz mode, or the whole queue in
 * queue mode, with the viewer's own buzz and team called out.
 */
export function GameWhoBuzzedIn({
  gameUserId: initialSelfUserId,
}: {
  gameUserId?: string;
}) {
  const gameSelfInfo = api.gameUser.getSelfInfo.useQuery(undefined, {
    enabled: !!initialSelfUserId,
  });
  const { data: state } = useLiveGameState();
  if (!state) return null;
  // A turn-based board shows whose turn it is instead (GameBuzzerTab).
  if (initialSelfUserId && noBuzzerTurn(state, initialSelfUserId)) return null;

  const selfTeamId = gameSelfInfo.data?.gameTeamId;
  const selfId = gameSelfInfo.data?.id ?? initialSelfUserId;
  const { game, buzzWinner: winner } = state;
  const isTeamGame = game.format === GameFormat.team;
  const teamName = (id: string) =>
    state.gameTeams.find((t) => t.id === id)?.name ?? "a removed team";

  /** "You", "Ada from your team", "Ada from Owls", "Owls" or "Bo". */
  const who = (teamId: string, userId: string | null) => {
    const player = userId ? state.gameUsers[userId]?.name : undefined;
    if (userId && userId === selfId) return "You";
    if (!player) return teamName(teamId);
    if (!isTeamGame) return player;
    if (teamId === selfTeamId) return `${player} from your team`;
    return `${player} from ${teamName(teamId)}`;
  };

  if (game.buzzerMode === "queue" && state.buzzQueue.length > 0) {
    return (
      <Panel aria-label="Buzz queue" title="Buzz queue">
        <ol className="flex flex-col gap-1.5">
          {state.buzzQueue.map((entry) => {
            const [label, tone] = QUEUE_STATUS[entry.status];
            const mine = isTeamGame
              ? entry.gameTeamId === selfTeamId
              : entry.gameUserId === selfId;
            return (
              <li
                key={entry.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2 py-1.5",
                  entry.status === "answering"
                    ? "border-info bg-accent-soft"
                    : "border-border",
                  entry.status === "skipped" && "opacity-60",
                  mine && "ring-info ring-2",
                )}
              >
                <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                  {entry.position}
                </span>
                <span className="min-w-0 flex-1 font-semibold break-words">
                  {who(entry.gameTeamId, entry.gameUserId)}
                </span>
                <StatusPill tone={tone}>{label}</StatusPill>
              </li>
            );
          })}
        </ol>
      </Panel>
    );
  }

  let content;
  if (winner) {
    const winnerUser = winner.gameUserId
      ? state.gameUsers[winner.gameUserId]
      : undefined;
    const name = who(winner.gameTeamId, winner.gameUserId);
    content = (
      <div className="flex items-center gap-3">
        {winnerUser && (
          <GameUserAvatar
            image={winnerUser.image ?? undefined}
            index={winnerUser.index}
          />
        )}
        <p className="text-lg font-semibold">
          {name === "You" ? "You buzzed in!" : `${name} buzzed in.`}
        </p>
      </div>
    );
  } else {
    content = (
      <p className="text-muted-foreground">
        {game.isBuzzerListening
          ? "Buzzer open. Nobody has buzzed yet."
          : "Buzzer closed."}
      </p>
    );
  }
  return <Panel aria-label="Buzzes">{content}</Panel>;
}
