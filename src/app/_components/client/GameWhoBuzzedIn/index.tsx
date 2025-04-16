"use client";

import { useState } from "react";
import { api } from "@/trpc/react";

import { GameFormat, type GameUser } from "@prisma/client";
import { GenericCard } from "@/app/_components/GenericCard";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/app/_components/ui/avatar";

import { logger } from "@/utils/logger";

export function GameWhoBuzzedIn({
  gameUserId,
}: {
  gameUserId?: GameUser["id"];
}) {
  const [hasSeenData, setHasSeenData] = useState(false);
  const whoBuzzedInResult = api.gameGeneral.whoBuzzedIn.useSubscription();

  let content;

  if (whoBuzzedInResult.data) {
    const {
      id: userId,
      name: userName,
      index: userIndex,
      gameTeam: { name: teamName },
      image: userImageUrl,
    } = whoBuzzedInResult.data.gameUser;

    if (gameUserId === userId) {
      content = <p>You have managed to buzz in!</p>;
    } else {
      logger.debug(`GameWhoBuzzedIn userImageUrl: ${userImageUrl}`);
      content = (
        <div>
          <Avatar>
            <AvatarImage
              src={userImageUrl ?? undefined}
              referrerPolicy="no-referrer" // needed for google images to load
            />
            <AvatarFallback>P{userIndex}</AvatarFallback>
          </Avatar>
          <p>{`[${userName}] from [${teamName}] has buzzed in.`}</p>
        </div>
      );
    }
    if (!hasSeenData) {
      setHasSeenData(true);
    }
  } else if (hasSeenData) {
    content = <p>No one has buzzed in yet.</p>;
  } else {
    content = "";
  }

  return <GenericCard content={content} />;
}
