"use client";

import { useState } from "react";
import { api } from "@/trpc/react";

import { GameFormat, type GameUser } from "@prisma/client";
import { GenericCard } from "@/app/_components/GenericCard";

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
      gameTeam: { name: teamName },
    } = whoBuzzedInResult.data.gameUser;

    if (gameUserId === userId) {
      content = <p>You have managed to buzz in!</p>;
    } else {
      content = <p>{`[${userName}] from [${teamName}] has buzzed in.`}</p>;
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
