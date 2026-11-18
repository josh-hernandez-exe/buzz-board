"use client";

import { helpHref } from "@/help/manifest";
import { useState } from "react";

import { useGameTokenData } from "@/app/_hooks/gameTokenData";
import { api } from "@/trpc/react";
import type { DashboardGame } from "@/types";

import { GameTeamUserTable } from "./GameViewDataTable";

/** The host's games: open one, or (as owner) delete it. */
export function UserGameView({
  games: initialGames,
}: {
  games: DashboardGame[];
}) {
  const [, setGameIdData] = useGameTokenData();
  const utils = api.useUtils();
  const gameInfo = api.user.game.getAll.useQuery(undefined, {
    initialData: initialGames,
  });
  const [hideFinished, setHideFinished] = useState(false);
  const deleteGame = api.user.deleteGame.useMutation({
    onSuccess: () => utils.user.game.getAll.invalidate(),
  });

  const all = gameInfo.data;
  const finishedCount = all.filter((g) => g.status === "finished").length;
  const games = hideFinished ? all.filter((g) => g.status !== "finished") : all;

  // First run: point a new host at the guide where they're looking, rather
  // than a permanent button every returning host has to skip past.
  if (all.length === 0) {
    return (
      <p data-testid="no-games" className="text-muted-foreground text-sm">
        No games yet. Create one above: it takes a minute. New to hosting?{" "}
        <a
          className="text-foreground underline"
          href={helpHref("host-quickstart")}
        >
          Read the host guide
        </a>{" "}
        (about 3 minutes).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {finishedCount > 0 && (
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={hideFinished}
            onChange={(e) => setHideFinished(e.target.checked)}
          />
          Hide finished games ({finishedCount})
        </label>
      )}
      <GameTeamUserTable
        data={games}
        onSelectClick={(gameId) => setGameIdData({ gameId })}
        deleteGame={deleteGame}
      />
    </div>
  );
}
