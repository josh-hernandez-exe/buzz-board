"use client";

import { useState } from "react";
import { api } from "@/trpc/react";

import { GameFormat, type GameUser, type GameTeam } from "@prisma/client";
import { GenericCard } from "@/app/_components/GenericCard";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/app/_components/ui/avatar";

import { logger } from "@/utils/logger";

export function GameWhoBuzzedIn({
  gameUserId,
  gameTeamUserId,
}: {
  gameUserId?: GameUser["id"] | null;
  gameTeamUserId?: GameTeam["id"] | null;
}) {
  const whoBuzzedInResult = api.gameGeneral.whoBuzzedIn.useSubscription();

  let content;

  logger.debug(`GameWhoBuzzedIn: ${JSON.stringify(whoBuzzedInResult?.data)}`);

  if (whoBuzzedInResult.data) {
    const { game, gameUser } = whoBuzzedInResult.data;

    if (gameUser && gameUser.id === gameUserId) {
      content = <p>You have buzz in!</p>;
    } else if (gameUser) {
      logger.debug(`GameWhoBuzzedIn userImageUrl: ${gameUser.image}`);
      let message;

      if (
        game.format === GameFormat.team &&
        gameUser.gameTeam.id === gameTeamUserId
      ) {
        message = `[${gameUser.name}] from your team has buzzed in.`;
      } else if (game.format === GameFormat.team) {
        message = `[${gameUser.name}] from [${gameUser.gameTeam?.name}] has buzzed in.`;
      } else if (game.format === GameFormat.individual) {
        message = `[${gameUser.name}] has buzzed in.`;
      }

      content = (
        <div>
          <Avatar>
            <AvatarImage
              src={gameUser.image ?? undefined}
              referrerPolicy="no-referrer" // needed for google images to load
            />
            <AvatarFallback>P{gameUser.index}</AvatarFallback>
          </Avatar>
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
