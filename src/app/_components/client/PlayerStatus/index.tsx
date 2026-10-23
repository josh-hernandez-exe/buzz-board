"use client";

import { GameFormat, GameStatus } from "@prisma/client";
import { useRouter } from "next/navigation";

import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import { useGameTokenData } from "@/app/_hooks/gameTokenData";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { api } from "@/trpc/react";
import { helpHref } from "@/help/manifest";

/**
 * Who and where the player is: game, code, their name and team. Also offers
 * leaving the room on this device, which only forgets this browser's
 * credential; the player's name, team and scores stay in the game.
 */
export function PlayerHeader({
  gameUserId,
  signedIn = false,
  linked = false,
}: {
  gameUserId: string;
  /** Whether this browser is signed in to an account. */
  signedIn?: boolean;
  /** Whether this player is already saved to an account. */
  linked?: boolean;
}) {
  const router = useRouter();
  const { data } = useLiveGameState();
  const [, , leaveGame] = useGameTokenData();
  const linkAccount = api.gameUser.linkAccount.useMutation();
  if (!data) return null;
  const isLinked = linked || linkAccount.isSuccess;

  const { game } = data;
  const self = data.gameUsers[gameUserId];
  const team = data.gameTeams.find((t) => t.id === self?.gameTeamId);

  return (
    <header className="bg-surface border-border flex w-full flex-col gap-2 rounded-xl border p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl font-extrabold break-words">
          {game.name}
        </h1>
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
      {game.format === GameFormat.team && game.captainsOnly && team && (
        <p data-testid="player-captain" className="text-sm">
          {team.captainId === gameUserId ? (
            <>
              <strong>★ You&apos;re the team captain:</strong> you buzz and
              answer for {team.name}.
            </>
          ) : (
            <>
              ★ <strong>{captainName(data, team.captainId)}</strong> is your
              team captain and buzzes and answers for the team.
            </>
          )}
        </p>
      )}
      {game.status === GameStatus.finished && (
        <p role="status" className="bg-muted rounded-md px-3 py-2">
          This game has finished. Final scores are on the scoreboard.
        </p>
      )}
      <a
        href={helpHref("troubleshooting", "why-cant-i-buzz")}
        target="_blank"
        rel="noopener"
        className="text-muted-foreground text-sm underline"
      >
        Help: what do the buzzer messages mean?
      </a>
      {isLinked ? (
        <p className="text-muted-foreground text-sm">
          Saved to your account: sign in on another device to get back in as
          yourself.
        </p>
      ) : (
        signedIn && (
          <div className="flex flex-col gap-1 text-sm">
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={linkAccount.isPending}
              onClick={() => linkAccount.mutate()}
            >
              Save this player to my account
            </Button>
            <span className="text-muted-foreground">
              Lets you get back in on another device by signing in.
            </span>
            <ErrorNotice
              error={linkAccount.error}
              className="text-destructive text-sm"
            />
          </div>
        )
      )}
      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer">
          Leave this room on this device
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-muted-foreground">
            This browser forgets you in this game. Your name, team and points
            stay in the game. To return as yourself later, sign in (if you saved
            this player to your account) or ask your host for a recovery link.
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

function captainName(
  state: { gameUsers: Record<string, { name: string } | undefined> },
  captainId: string | null,
) {
  return (captainId && state.gameUsers[captainId]?.name) ?? "Nobody yet";
}
