"use client";

import { useEffect, useRef, useState } from "react";


import { JoinQrCode, joinUrl } from "@/app/_components/client/JoinQrCode";

import { GameFormat, GameStatus, TeamAssignment } from "@prisma/client";
import { useRouter } from "next/navigation";

import { Panel } from "@/app/_components/ui/page";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/app/_components/ui/dialog";
import { Switch } from "@/app/_components/ui/switch";
import { api } from "@/trpc/react";
import { newRequestId } from "@/utils/requestId";
import { ASSIGNMENT_LABEL, GAME_LIMITS } from "@/utils/gameRules";
import { can, type StaffRoleName } from "@/utils/capabilities";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { helpHref } from "@/help/manifest";
import { DeleteGameDialog } from "@/app/_components/client/DeleteGameDialog";

/**
 * The host desk's room settings: the QR code, who may join, and the game's
 * lifecycle. Moderators see only the sharing part; delete is owner-only.
 */
export function HostRoomPanel({ staffRole }: { staffRole: StaffRoleName }) {
  const isOwner = can(staffRole, "deleteGame");
  const runsGame = can(staffRole, "runGame");
  const router = useRouter();
  const { data } = useLiveGameState();
  // Updated each minute so "Reopen" disables once the 24-hour window ends.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const duplicateRequestId = useRef(newRequestId());

  const setJoiningOpen = api.gameAdmin.setJoiningOpen.useMutation();
  const setTeamAssignment = api.gameAdmin.setTeamAssignment.useMutation();
  const finishGame = api.gameAdmin.finishGame.useMutation();
  const reopenGame = api.gameAdmin.reopenGame.useMutation();
  const duplicateGame = api.gameAdmin.duplicateGame.useMutation({
    onSuccess: ({ gameId }) => {
      duplicateRequestId.current = newRequestId();
      router.push(`/game/${gameId}/admin`);
    },
  });
  const deleteGame = api.gameAdmin.deleteGame.useMutation({
    onSuccess: () => router.push("/dashboard"),
  });

  if (!data) return null;
  const { game } = data;
  const playerCount = Object.keys(data.gameUsers).length;
  const finished = game.status === GameStatus.finished;
  const canReopen =
    finished &&
    !!game.finishedAt &&
    now - new Date(game.finishedAt).getTime() <= GAME_LIMITS.reopenWindowMs;

  return (
    <Panel aria-label="Room" title="Room">
      <div className="flex flex-col gap-6">
        <section
          aria-labelledby="share-heading"
          className="flex flex-col gap-4 sm:flex-row"
        >
          <div className="flex flex-1 flex-col gap-2">
            <h3 id="share-heading" className="font-semibold">
              Invite players
            </h3>
            <p className="text-sm">
              Players open{" "}
              <span className="font-mono break-all">{joinUrl(game.code)}</span>{" "}
              or scan the code. Everyone can also go to the home page and type
              the join code <strong className="font-mono">{game.code}</strong>.
            </p>
            <p className="text-muted-foreground text-sm">
              Screen-share the audience display, not this host desk. It shows
              scores and buzzes, never controls.{" "}
              <a
                href={helpHref(
                  "scoreboards-and-display",
                  "what-is-the-audience-display",
                )}
                target="_blank"
                rel="noopener"
                className="underline"
              >
                About the display
              </a>
            </p>
          </div>
          <div className="flex flex-col items-center">
            <JoinQrCode code={game.code} />
            <span className="text-muted-foreground text-xs">Scan to join</span>
          </div>
        </section>

        {runsGame && (
          <section
            aria-labelledby="joining-heading"
            className="flex flex-col gap-3"
          >
            <h3 id="joining-heading" className="font-semibold">
              Players ({playerCount})
            </h3>
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="joining-open" className="text-sm">
                {game.joiningOpen
                  ? "New players can join"
                  : "Joining is closed; players already in can still return"}
              </label>
              <Switch
                id="joining-open"
                aria-label="Allow new players to join"
                checked={game.joiningOpen}
                disabled={finished || setJoiningOpen.isPending}
                onCheckedChange={(open: boolean) =>
                  setJoiningOpen.mutate({ open })
                }
              />
            </div>
            {game.format === GameFormat.team && (
              <label className="flex flex-col gap-1 text-sm">
                Team assignment for new players
                <select
                  className="field px-2 py-1"
                  value={game.teamAssignment}
                  disabled={finished || setTeamAssignment.isPending}
                  onChange={(e) =>
                    setTeamAssignment.mutate({
                      teamAssignment: e.target.value as TeamAssignment,
                    })
                  }
                >
                  {Object.values(TeamAssignment).map((value) => (
                    <option key={value} value={value}>
                      {ASSIGNMENT_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ErrorNotice
              error={setJoiningOpen.error ?? setTeamAssignment.error}
            />
          </section>
        )}

        {runsGame && (
          <section
            aria-labelledby="game-heading"
            className="flex flex-col gap-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 id="game-heading" className="font-semibold">
                Game
              </h3>
              <a
                href={helpHref("host-quickstart")}
                target="_blank"
                rel="noopener"
                className="text-sm underline"
              >
                Host guide
              </a>
            </div>
            <div className="flex flex-wrap gap-2">
              {!finished && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">Finish game…</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Finish this game?</DialogTitle>
                      <DialogDescription>
                        The buzzer closes, nobody new can join, and players can
                        no longer change names or teams. Scores stay visible.
                        You can reopen within 24 hours to correct results.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="secondary">Keep playing</Button>
                      </DialogClose>
                      <DialogClose asChild>
                        <Button onClick={() => finishGame.mutate()}>
                          Finish game
                        </Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
              {finished && (
                <Button
                  variant="outline"
                  disabled={!canReopen || reopenGame.isPending}
                  title={
                    canReopen
                      ? undefined
                      : "Games can only be reopened within 24 hours of finishing."
                  }
                  onClick={() => reopenGame.mutate()}
                >
                  Reopen to correct results
                </Button>
              )}
              <Button
                variant="outline"
                disabled={duplicateGame.isPending}
                onClick={() =>
                  duplicateGame.mutate({
                    requestId: duplicateRequestId.current,
                  })
                }
              >
                {duplicateGame.isPending ? "Duplicating…" : "Duplicate"}
              </Button>
              {isOwner && (
                <DeleteGameDialog
                  game={{
                    name: game.name,
                    status: game.status,
                    playerCount,
                  }}
                  onDelete={(input) => deleteGame.mutate(input)}
                  isPending={deleteGame.isPending}
                  error={deleteGame.error}
                />
              )}
            </div>
            <ErrorNotice
              error={
                finishGame.error ?? reopenGame.error ?? duplicateGame.error
              }
            />
          </section>
        )}
      </div>
    </Panel>
  );
}
