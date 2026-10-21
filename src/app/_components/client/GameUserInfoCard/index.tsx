"use client";

import { env } from "@/env";

import type { Prisma } from "@prisma/client";

import { Panel } from "@/app/_components/ui/page";

import { GameUserAvatar } from "@/app/_components/client/GameUserAvatar";
import { GameUserEditSheet } from "@/app/_components/client/GameUserEditSheet";
import { api } from "@/trpc/react";

type GameUserProps = Prisma.GameUserGetPayload<{
  select: {
    id: true;
    name: true;
    index: true;
    user: {
      select: {
        image: true;
      };
    };
  };
}>;

export function GameUserInfoCard({
  gameUser: initialGameUser,
}: {
  gameUser?: GameUserProps | undefined;
}) {
  const gameSelfInfo = api.gameUser.getSelfInfo.useQuery();

  const gameUser = initialGameUser ?? gameSelfInfo.data;

  if (!gameUser) {
    return null;
  }

  return (
    <Panel
      title="You"
      description="How you appear in this game"
      actions={<GameUserEditSheet />}
    >
      <div className="flex items-center gap-3">
        <GameUserAvatar image={gameUser?.user?.image} index={gameUser?.index} />
        <div>
          <p className="text-lg font-bold">{gameUser?.name}</p>
          <p className="text-muted-foreground text-sm">
            Player {gameSelfInfo.data?.index ?? gameUser.index}
          </p>
          {env.NEXT_PUBLIC_SHOW_DEBUG_INFO && (
            <p className="text-muted-foreground text-xs">
              Player ID: {gameSelfInfo.data?.id}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
