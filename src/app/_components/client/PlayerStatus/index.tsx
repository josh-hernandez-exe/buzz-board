"use client";

import { GameFormat, GameStatus } from "@prisma/client";
import { useRouter } from "next/navigation";

import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import { useGameTokenData } from "@/app/_hooks/gameTokenData";
import { helpHref } from "@/help/manifest";

/**
 * Who and where the player is: game, code, their name and team. Also offers
 * leaving the room on this device, which only forgets this browser's
 * credential; the player's name, team and scores stay in the game.
 */
export function PlayerHeader({ gameUserId }: { gameUserId: string }) {
  const router = useRouter();
  const { data } = useLiveGameState();
  const [, , leaveGame] = useGameTokenData();
  if (!data) return null;

  const { game } = data;
  const self = data.gameUsers[gameUserId];
  const team = data.gameTeams.find((t) => t.id === self?.gameTeamId);

  return (
    <header className="flex w-full max-w-md flex-col gap-2 rounded-xl bg-white/10 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">{game.name}</h1>
        <span className="font-mono text-sm tracking-widest">{game.code}</span>
      </div>
      <p data-testid="player-identity">
        You are <strong>{self?.name ?? "a player"}</strong>
        {game.format === GameFormat.team && (
          <>
            {" "}
            {team ? (
              <>
                on <strong>{team.name}</strong>
              </>
            ) : (
              "without a team yet"
            )}
          </>
        )}
        .
      </p>
      {game.status === GameStatus.finished && (
        <p role="status" className="rounded-md bg-white/20 px-3 py-2">
          This game has finished. Final scores are on the scoreboard.
        </p>
      )}
      <a
        href={helpHref("troubleshooting", "why-cant-i-buzz")}
        target="_blank"
        rel="noopener"
        className="text-sm text-white/80 underline"
      >
        Help: what do the buzzer messages mean?
      </a>
      <details className="text-sm">
        <summary className="cursor-pointer text-white/80">
          Leave this room on this device
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-white/80">
            This browser forgets you in this game. Your name, team and points
            stay in the game, but you can only return here as yourself if you
            signed in, or if your host helps you.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              leaveGame({ gameId: game.id, code: game.code });
              router.push("/join");
            }}
          >
            Leave on this device
          </Button>
        </div>
      </details>
    </header>
  );
}
