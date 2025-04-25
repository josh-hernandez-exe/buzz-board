"use client";

import { api } from "@/trpc/react";

import { GameFormat } from "@prisma/client";
import { GameUserAvatar } from "@/app/_components/client/GameUserAvatar";
import { GenericCard } from "@/app/_components/GenericCard";

import { logger } from "@/logger";

export function GameWhoBuzzedIn({
  gameUserId: selfGameUserId,
}: {
  gameUserId?: string;
}) {
  // NOTE: it's okay if getSelfInfo fails for an admin user
  const gameSelfInfo = api.gameUser.getSelfInfo.useQuery();
  const whoBuzzedInResult = api.gameGeneral.whoBuzzedIn.useSubscription();
  const selfTeamId = gameSelfInfo.data?.gameTeamId;

  let content;

  logger.debug(`GameWhoBuzzedIn: ${JSON.stringify(whoBuzzedInResult?.data)}`);

  if (whoBuzzedInResult.data) {
    const { game, gameUser } = whoBuzzedInResult.data;

    if (gameUser && gameUser.id === selfGameUserId) {
      content = <p>You have buzz in!</p>;
    } else if (gameUser) {
      logger.debug(`GameWhoBuzzedIn userImageUrl: ${gameUser.image}`);
      let message;

      if (
        game.format === GameFormat.team &&
        gameUser.gameTeam.id === selfTeamId
      ) {
        message = `[${gameUser.name}] from your team has buzzed in.`;
      } else if (game.format === GameFormat.team) {
        message = `[${gameUser.name}] from [${gameUser.gameTeam?.name}] has buzzed in.`;
      } else if (game.format === GameFormat.individual) {
        message = `[${gameUser.name}] has buzzed in.`;
      }

      content = (
        <div>
          <GameUserAvatar
            image={gameUser.image ?? undefined}
            index={gameUser.index}
          />
          <p>{message}</p>
        </div>
      );
    } else if (!gameUser && game.isBuzzerListening) {
      content = <p>Buzzer is listening and no one has buzzed in yet.</p>;
    } else if (!gameUser && !game.isBuzzerListening) {
      content = <p>Buzzer is not listening.</p>;
    } else {
      content = <p>Unknown state.</p>;
    }
  } else {
    content = <p>Loading.</p>;
  }

  return <GenericCard content={content} />;
}
