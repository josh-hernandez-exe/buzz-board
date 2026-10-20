"use client";

import type { JSX } from "react";
import { api } from "@/trpc/react";

import { GameFormat } from "@prisma/client";
import { GameUserAvatar } from "@/app/_components/client/GameUserAvatar";
import { GenericCard } from "@/app/_components/GenericCard";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";

export function GameWhoBuzzedIn({
  gameUserId: initialSelfUserId,
}: {
  gameUserId?: string;
}) {
  const gameSelfInfo = api.gameUser.getSelfInfo.useQuery(undefined, {
    enabled: !!initialSelfUserId,
  });
  const { data: gameState } = useLiveGameState();
  const selfTeamId = gameSelfInfo.data?.gameTeamId;
  const selfGameUserId = gameSelfInfo.data?.id ?? initialSelfUserId;

  const winner = gameState?.buzzWinner;
  const winnerUser = winner?.gameUserId
    ? gameState?.gameUsers[winner.gameUserId]
    : undefined;
  const winnerTeam = winner
    ? gameState?.gameTeams.find((team) => team.id === winner.gameTeamId)
    : undefined;

  let content: JSX.Element;

  if (gameState) {
    const { game } = gameState;
    if (winner && winner.gameUserId === selfGameUserId) {
      content = <p>You have buzzed in!</p>;
    } else if (winner) {
      const teamName = winnerTeam?.name ?? "a removed team";
      const playerName = winnerUser?.name;
      let message: string;
      if (!playerName) {
        message = `[${teamName}] has buzzed in.`;
      } else if (
        game.format === GameFormat.team &&
        winner.gameTeamId === selfTeamId
      ) {
        message = `[${playerName}] from your team has buzzed in.`;
      } else if (game.format === GameFormat.team) {
        message = `[${playerName}] from [${teamName}] has buzzed in.`;
      } else {
        message = `[${playerName}] has buzzed in.`;
      }
      content = (
        <div className="flex items-center space-x-2">
          {winnerUser && (
            <GameUserAvatar
              image={winnerUser.image ?? undefined}
              index={winnerUser.index}
            />
          )}
          <p>{message}</p>
        </div>
      );
    } else if (game.isBuzzerListening) {
      content = <p>Buzzer is listening and no one has buzzed in yet.</p>;
    } else {
      content = <p>Buzzer is not listening.</p>;
    }
  } else {
    content = <></>;
  }

  return <GenericCard content={content} />;
}
